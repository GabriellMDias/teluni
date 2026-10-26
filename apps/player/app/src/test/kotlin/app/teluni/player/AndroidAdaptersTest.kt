package app.teluni.player

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.media3.common.util.UnstableApi
import app.teluni.player.core.catalog.EffectivePrice
import app.teluni.player.core.catalog.PriceSource
import app.teluni.player.core.playback.PlaybackCondition
import app.teluni.player.core.playback.Plan
import app.teluni.player.core.playback.AreaPlan
import app.teluni.player.core.playback.ShownRecord
import app.teluni.player.core.protocol.AreaKind
import app.teluni.player.core.store.CrashJournal
import app.teluni.player.core.store.PlayerStore
import app.teluni.player.core.protocol.ManifestParser
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "pt-rBR")
@UnstableApi
class AndroidAdaptersTest {
    @Test fun `catalog snapshot renders a branch price when money field decimals are absent`() {
        val fixture = Json.parseToJsonElement(File(requireNotNull(System.getProperty("teluni.conformance"))).readText())
            .jsonObject.getValue("layoutManifest").jsonObject
        val publication = ManifestParser.parse(fixture.getValue("bytes").jsonPrimitive.content.toByteArray(),
            fixture.getValue("sha256").jsonPrimitive.content)
        val layout = requireNotNull(publication.layout)
        val area = layout.areas.first { it.kind == AreaKind.CATALOG }
        val view = requireNotNull(area.view)
        val catalog = layout.catalogs.getValue(view.catalogId)
        val money = catalog.fields.values.first { it.type == "money" }
        assertNull(money.decimals)
        val entries = view.pages.first().map { entry ->
            ShownRecord(catalog.records.getValue(entry.recordId), entry.group,
                mapOf(money.id to EffectivePrice(1790, PriceSource.OVERRIDE, null)))
        }
        val context = RuntimeEnvironment.getApplication() as Context
        val output = CatalogView(context, PlayerRuntime(context), publication, AreaPlan.Catalog(area, view, entries))
        output.measure(View.MeasureSpec.makeMeasureSpec(area.width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(area.height, View.MeasureSpec.EXACTLY))
        output.layout(0, 0, area.width, area.height)
        assertTrue(descendants(output).filterIsInstance<TextView>().any { it.text.toString().contains("17,90") })
    }

    @Test fun `catalog output reflects degradation and recovers without changing generations`() {
        val fixture = Json.parseToJsonElement(File(requireNotNull(System.getProperty("teluni.conformance"))).readText())
            .jsonObject.getValue("layoutManifest").jsonObject
        val publication = ManifestParser.parse(fixture.getValue("bytes").jsonPrimitive.content.toByteArray(),
            fixture.getValue("sha256").jsonPrimitive.content)
        val area = requireNotNull(publication.layout).areas.first { it.kind == AreaKind.CATALOG }
        val view = requireNotNull(area.view)
        val context = RuntimeEnvironment.getApplication() as Context
        val output = PlaybackView(context, PlayerRuntime(context))
        val catalog = requireNotNull(publication.layout).catalogs.getValue(view.catalogId)
        val records = view.pages.first().map { ShownRecord(catalog.records.getValue(it.recordId), it.group, emptyMap()) }
        val intact = Plan.Compose(publication, listOf(AreaPlan.Catalog(area, view, records)), null)
        try {
            output.show(intact, 0)
            val labels = descendants(output).filterIsInstance<TextView>().toList()
            assertTrue(labels.any { it.text.isNotEmpty() })
            output.show(intact.copy(publication = publication.copy(media = emptyMap()), degraded = true), 0)
            assertTrue(output.hasFailure)
            output.show(intact.copy(mediaVersions = publication.media.values.associate { it.sha256 to 1L }), 0)
            assertFalse(output.hasFailure)
            val after = descendants(output).filterIsInstance<TextView>().toList()
            assertEquals(labels.size, after.size)
            labels.zip(after).forEach { (before, next) -> assertSame(before, next) }
            output.show(Plan.Neutral(PlaybackCondition.DEGRADED, null), 0)
            assertTrue(output.hasFailure)
        } finally { output.release() }
    }

    @Test fun `uncaught crash handling counts a failure without storing its message filename or foreign frames`() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        var delegated = false
        try {
            Thread.setDefaultUncaughtExceptionHandler { _, _ -> delegated = true }
            val application = RuntimeEnvironment.getApplication() as PlayerApplication
            application.onCreate()
            val failure = IllegalStateException("SYNTHETIC_SECRET").apply {
                stackTrace = arrayOf(
                    StackTraceElement("app.teluni.player.PlayerActivity", "onCreate", "SYNTHETIC_SECRET", 42),
                    StackTraceElement("other.SYNTHETIC_SECRET", "read", "secret", 1))
            }
            requireNotNull(Thread.getDefaultUncaughtExceptionHandler()).uncaughtException(Thread.currentThread(), failure)
            assertTrue(delegated)
            val store = PlayerStore(application.filesDir.toPath().resolve("player"))
            assertEquals(1, CrashJournal(store).count())
            val raw = requireNotNull(store.record(PlayerStore.Record.DIAGNOSTICS)).decodeToString()
            assertFalse(raw.contains("SYNTHETIC_SECRET"))
            assertTrue(raw.contains("PlayerActivity.onCreate:42"))
        } finally { Thread.setDefaultUncaughtExceptionHandler(previous) }
    }

    @Test fun `TV setup focuses connect instead of opening the soft keyboard`() {
        Robolectric.buildActivity(PlayerActivity::class.java).setup().use { controller ->
            val activity = controller.get()
            PlayerActivity::class.java.getDeclaredMethod("render", PlayerSnapshot::class.java).apply {
                isAccessible = true
            }.invoke(activity, PlayerSnapshot())
            val connect = descendants(activity.findViewById(android.R.id.content)).filterIsInstance<Button>().single()
            assertTrue(connect.hasFocus())
        }
    }

    @Test fun `setup rejects credential-bearing endpoints without writing configuration`() {
        Robolectric.buildActivity(PlayerActivity::class.java).setup().use { controller ->
            val activity = controller.get()
            // Exercise manual input even when this test build has a preset.
            PlayerActivity::class.java.getDeclaredMethod("render", PlayerSnapshot::class.java).apply {
                isAccessible = true
            }.invoke(activity, PlayerSnapshot())
            val views = descendants(activity.findViewById(android.R.id.content)).toList()
            views.filterIsInstance<EditText>().single().setText("https://user:synthetic-secret@example.test")
            views.filterIsInstance<Button>().single().performClick()
            assertTrue(views.filterIsInstance<TextView>().any { it.text.toString() == activity.getString(R.string.invalid_endpoint) })
            assertFalse(activity.filesDir.resolve("endpoint.txt").exists())
        }
    }

    @Test fun `preset builds open pairing without asking for an API address`() {
        Robolectric.buildActivity(PlayerActivity::class.java).setup().use { controller ->
            val activity = controller.get()
            val views = descendants(activity.findViewById(android.R.id.content)).toList()
            if (BuildConfig.API_ENDPOINT.isNotEmpty()) {
                assertTrue(views.filterIsInstance<EditText>().isEmpty())
                assertTrue(views.filterIsInstance<TextView>().any {
                    it.contentDescription == activity.getString(R.string.pairing_description)
                })
            } else {
                assertEquals(1, views.filterIsInstance<EditText>().size)
            }
        }
    }

    @Test fun `pairing code is excluded from the UI state diagnostic string`() {
        assertFalse(PlayerSnapshot(userCode = "SYNTHETIC-CODE").toString().contains("SYNTHETIC"))
    }

    private fun descendants(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(descendants(view.getChildAt(index)))
    }

    @Test fun `clock uses system automatic time and boot count without local time zone rules`() {
        val context = RuntimeEnvironment.getApplication() as Context
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 12)
        Settings.Global.putInt(context.contentResolver, Settings.Global.AUTO_TIME, 0)
        val first = AndroidClock(context)
        assertFalse(first.automaticTime())
        Settings.Global.putInt(context.contentResolver, Settings.Global.AUTO_TIME, 1)
        assertTrue(first.automaticTime())
        assertEquals(first.bootId(), AndroidClock(context).bootId())
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 13)
        assertNotEquals(first.bootId(), AndroidClock(context).bootId())
    }

    @Test fun `unmanaged installation never grants itself device ownership or lock task`() {
        val context = RuntimeEnvironment.getApplication() as Context
        val policy = context.getSystemService(DevicePolicyManager::class.java)
        assertFalse(ManagedDevice.configure(context))
        assertFalse(policy.isDeviceOwnerApp(context.packageName))
    }

    @Test fun `owner profile permits only this player in lock task`() {
        val context = RuntimeEnvironment.getApplication() as Context
        val policy = context.getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(context, PlayerAdminReceiver::class.java)
        shadowOf(policy).setDeviceOwner(admin)
        assertTrue(ManagedDevice.configure(context))
        assertArrayEquals(arrayOf(context.packageName), policy.getLockTaskPackages(admin))
    }
}
