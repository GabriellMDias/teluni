package app.teluni.player.core.protocol

import app.teluni.player.core.Fixtures
import app.teluni.player.core.string
import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.JWSObject
import com.nimbusds.jose.Payload
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jose.crypto.MACSigner
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

class StatementsTest {
    private val fixtures = Fixtures.conformance
    private val keys = KeySet.parse(fixtures.getValue("keys").toString())
    private val claims = fixtures.getValue("statements").jsonArray[0].jsonObject.getValue("claims").jsonObject
    private val device = claims.getValue("sub").string
    private val company = claims.getValue("company").string

    /** The compact form a screen receives, from the fixture's flattened JWS JSON serialization. */
    private fun compact(statement: JsonObject): String =
        listOf("protected", "payload", "signature").joinToString(".") { statement.getValue(it).string }

    private fun assertRejected(reason: StatementRejection, block: () -> Unit) {
        assertEquals(reason, assertFailsWith<StatementRejected> { block() }.reason)
    }

    @Test
    fun `verifies the API's statements and rejects a tampered one`() {
        assertEquals(setOf("conformance-1", "conformance-2"), keys.ids)
        for (element in fixtures.getValue("statements").jsonArray) {
            val case = element.jsonObject
            val jws = compact(case)
            if (!case.getValue("valid").jsonPrimitive.boolean) {
                assertRejected(StatementRejection.SIGNATURE) { StatementVerifier.verify(jws, keys, device, company) }
                continue
            }
            val expected = case.getValue("claims").jsonObject
            val statement = StatementVerifier.verify(jws, keys, device, company)
            assertEquals(Instant.ofEpochSecond(expected.getValue("iat").jsonPrimitive.long), statement.issuedAt)
            assertEquals(Instant.ofEpochSecond(expected.getValue("exp").jsonPrimitive.long), statement.expiresAt)
            assertEquals(
                expected.getValue("publications").jsonArray.map {
                    AuthorizedPublication(it.jsonObject.getValue("id").string, it.jsonObject.getValue("sha256").string)
                },
                statement.publications,
            )
        }
        val manifest = fixtures.getValue("manifest").jsonObject
        val current = StatementVerifier.verify(
            compact(fixtures.getValue("statements").jsonArray[0].jsonObject),
            keys,
            device,
            company,
        )
        val publicationId = manifest.getValue("header").jsonObject.getValue("publicationId").string
        assertTrue(current.authorizes(publicationId, manifest.getValue("sha256").string))
        assertFalse(current.authorizes(publicationId, "0".repeat(64)))
    }

    @Test
    fun `binds statements to this screen and company`() {
        val jws = compact(fixtures.getValue("statements").jsonArray[0].jsonObject)
        assertRejected(StatementRejection.SUBJECT) { StatementVerifier.verify(jws, keys, "another-screen", company) }
        assertRejected(StatementRejection.SUBJECT) { StatementVerifier.verify(jws, keys, device, "another-company") }
    }

    private val key: ECKey = ECKeyGenerator(Curve.P_256).keyID("k1").generate()
    private val ownKeys = KeySet.parse(JWKSet(key.toPublicJWK()).toString())

    private fun sign(
        payload: String = """{"sub":"d","company":"c","iat":100,"exp":200,"publications":[]}""",
        type: String = StatementVerifier.TYPE,
        keyId: String = "k1",
    ): String {
        val header = JWSHeader.Builder(JWSAlgorithm.ES256).type(JOSEObjectType(type)).keyID(keyId).build()
        return JWSObject(header, Payload(payload)).apply { sign(ECDSASigner(key)) }.serialize()
    }

    @Test
    fun `rejects every malformed or foreign statement`() {
        assertEquals(Instant.ofEpochSecond(200), StatementVerifier.verify(sign(), ownKeys, "d", "c").expiresAt)
        assertRejected(StatementRejection.MALFORMED) { StatementVerifier.verify("not-a-jws", ownKeys, "d", "c") }
        assertRejected(StatementRejection.TYPE) { StatementVerifier.verify(sign(type = "JWT"), ownKeys, "d", "c") }
        assertRejected(StatementRejection.UNKNOWN_KEY) { StatementVerifier.verify(sign(keyId = "k9"), ownKeys, "d", "c") }
        assertEquals("k9", StatementVerifier.keyId(sign(keyId = "k9")))
        assertRejected(StatementRejection.CLAIMS) {
            StatementVerifier.verify(sign("""{"sub":"d","company":"c","iat":200,"exp":200,"publications":[]}"""), ownKeys, "d", "c")
        }
        assertRejected(StatementRejection.CLAIMS) { StatementVerifier.verify(sign("""{"sub":"d"}"""), ownKeys, "d", "c") }
        val hmac = JWSObject(
            JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType(StatementVerifier.TYPE)).keyID("k1").build(),
            Payload("""{"sub":"d","company":"c","iat":100,"exp":200,"publications":[]}"""),
        ).apply { sign(MACSigner(ByteArray(32) { 7 })) }.serialize()
        assertRejected(StatementRejection.ALGORITHM) { StatementVerifier.verify(hmac, ownKeys, "d", "c") }
        // Signed by a key with a pinned identifier but different material.
        val impostor = ECKeyGenerator(Curve.P_256).keyID("k1").generate()
        val forged = JWSObject(
            JWSHeader.Builder(JWSAlgorithm.ES256).type(JOSEObjectType(StatementVerifier.TYPE)).keyID("k1").build(),
            Payload("""{"sub":"d","company":"c","iat":100,"exp":200,"publications":[]}"""),
        ).apply { sign(ECDSASigner(impostor)) }.serialize()
        assertRejected(StatementRejection.SIGNATURE) { StatementVerifier.verify(forged, ownKeys, "d", "c") }
    }

    @Test
    fun `pins only public P-256 keys with identifiers`() {
        assertFailsWith<IllegalArgumentException> { KeySet.parse(JWKSet(key).toString(false)) }
        assertFailsWith<IllegalArgumentException> {
            KeySet.parse(JWKSet(RSAKeyGenerator(2048).keyID("r").generate().toPublicJWK()).toString())
        }
        assertFailsWith<IllegalArgumentException> {
            KeySet.parse(JWKSet(listOf(key.toPublicJWK(), key.toPublicJWK())).toString())
        }
        assertFailsWith<IllegalArgumentException> {
            KeySet.parse(JWKSet(ECKeyGenerator(Curve.P_256).generate().toPublicJWK()).toString())
        }
        assertFailsWith<IllegalArgumentException> { KeySet.parse("""{"keys":[]}""") }
        assertFailsWith<IllegalArgumentException> { KeySet.parse("nope") }
    }
}
