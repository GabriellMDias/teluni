package app.teluni.player.core.protocol

import com.nimbusds.jose.JOSEException
import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSObject
import com.nimbusds.jose.crypto.ECDSAVerifier
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.JWKSet
import java.text.ParseException
import java.time.Instant
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** A publication a statement lets the screen activate or keep active. */
@Serializable
public data class AuthorizedPublication(val id: String, val sha256: String)

/** A verified authorization statement (ADR-0030). */
public data class Statement(
    val jws: String,
    val subject: String,
    val company: String,
    val issuedAt: Instant,
    val expiresAt: Instant,
    val publications: List<AuthorizedPublication>,
) {
    /** Whether this statement lists a publication with exactly this manifest. */
    public fun authorizes(publicationId: String, manifestSha256: String): Boolean =
        publications.any { it.id == publicationId && it.sha256 == manifestSha256 }
}

public enum class StatementRejection { MALFORMED, ALGORITHM, TYPE, UNKNOWN_KEY, SIGNATURE, SUBJECT, CLAIMS }

public class StatementRejected(public val reason: StatementRejection) :
    Exception("Authorization statement rejected: $reason")

/** The pinned public keys that verify statements: P-256 keys for ES256 only. */
public class KeySet private constructor(private val keys: Map<String, ECKey>) {
    public val ids: Set<String> get() = keys.keys

    internal fun key(id: String): ECKey? = keys[id]

    public companion object {
        /** Parses a JSON Web Key Set as `GET /device/keys` returns it. */
        public fun parse(json: String): KeySet {
            val set = try {
                JWKSet.parse(json)
            } catch (_: ParseException) {
                throw IllegalArgumentException("The key set is not a JSON Web Key Set")
            }
            val keys = set.keys.map { key ->
                require(key is ECKey && key.curve == Curve.P_256 && !key.isPrivate) { "Only public P-256 keys verify statements" }
                require(key.algorithm == null || key.algorithm == JWSAlgorithm.ES256) { "Keys must be for ES256" }
                key to requireNotNull(key.keyID) { "Every key needs an identifier" }
            }
            require(keys.isNotEmpty()) { "The key set is empty" }
            require(keys.map { it.second }.toSet().size == keys.size) { "Key identifiers must be unique" }
            return KeySet(keys.associate { (key, id) -> id to key })
        }
    }
}

/**
 * Verifies statements exactly as the player design requires: ES256 with the
 * statement type and a pinned key, a valid signature, this screen as subject
 * and its company, and an expiry after the issue time. Expiry against
 * trusted time is the authorization's decision, not the verifier's.
 */
public object StatementVerifier {
    public const val TYPE: String = "teluni-authorization+jws"

    @Serializable
    private data class Claims(
        val sub: String,
        val company: String,
        val iat: Long,
        val exp: Long,
        val publications: List<AuthorizedPublication>,
    )

    private val json = Json { ignoreUnknownKeys = true }

    /** The key a statement names, so an unknown one can be fetched before verifying. */
    public fun keyId(jws: String): String? = try {
        JWSObject.parse(jws).header.keyID
    } catch (_: ParseException) {
        null
    }

    /**
     * Verifies a statement for this screen. `companyId` is the company pinned
     * from the first statement after pairing; null accepts the signed one,
     * which the caller then pins.
     */
    public fun verify(jws: String, keys: KeySet, deviceId: String, companyId: String?): Statement {
        val parsed = try {
            JWSObject.parse(jws)
        } catch (_: ParseException) {
            throw StatementRejected(StatementRejection.MALFORMED)
        }
        val header = parsed.header
        if (header.algorithm != JWSAlgorithm.ES256) throw StatementRejected(StatementRejection.ALGORITHM)
        if (header.type != JOSEObjectType(TYPE)) throw StatementRejected(StatementRejection.TYPE)
        val key = header.keyID?.let(keys::key) ?: throw StatementRejected(StatementRejection.UNKNOWN_KEY)
        val valid = try {
            parsed.verify(ECDSAVerifier(key))
        } catch (_: JOSEException) {
            false
        }
        if (!valid) throw StatementRejected(StatementRejection.SIGNATURE)
        val claims = try {
            json.decodeFromString(Claims.serializer(), parsed.payload.toString())
        } catch (_: SerializationException) {
            throw StatementRejected(StatementRejection.CLAIMS)
        } catch (_: IllegalArgumentException) {
            throw StatementRejected(StatementRejection.CLAIMS)
        }
        if (claims.sub != deviceId || (companyId != null && claims.company != companyId)) {
            throw StatementRejected(StatementRejection.SUBJECT)
        }
        if (claims.exp <= claims.iat) throw StatementRejected(StatementRejection.CLAIMS)
        return Statement(
            jws,
            claims.sub,
            claims.company,
            Instant.ofEpochSecond(claims.iat),
            Instant.ofEpochSecond(claims.exp),
            claims.publications,
        )
    }
}
