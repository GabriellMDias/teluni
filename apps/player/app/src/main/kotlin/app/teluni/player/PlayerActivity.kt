package app.teluni.player

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.os.SystemClock
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.media3.common.util.UnstableApi
import app.teluni.player.core.playback.Plan
import app.teluni.player.core.playback.PlaybackCondition

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class PlayerActivity : Activity() {
    private val runtime get() = (application as PlayerApplication).runtime
    private lateinit var root: FrameLayout
    private lateinit var playback: PlaybackView
    private var setup: LinearLayout? = null
    private var pairing: TextView? = null
    private var status: TextView? = null
    private var last = PlayerSnapshot()
    private val main = Handler(Looper.getMainLooper())
    private val hideStatus = Runnable { status?.visibility = View.GONE }
    private var statusExpiresAt = 0L
    private val observer: (PlayerSnapshot) -> Unit = { render(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        playback = PlaybackView(this, runtime)
        root.addView(playback, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        hideSystemBars()
        ManagedDevice.enter(this)
    }

    override fun onStart() {
        super.onStart()
        runtime.observe(observer)
        startForegroundService(Intent(this, PlayerService::class.java))
    }

    override fun onStop() {
        runtime.removeObserver(observer)
        main.removeCallbacks(hideStatus)
        playback.release()
        runtime.reportPlayback(PlaybackCondition.NEUTRAL)
        super.onStop()
    }

    private fun render(snapshot: PlayerSnapshot) {
        last = snapshot
        if (!snapshot.configured) {
            if (setup == null) showSetup()
            return
        }
        setup?.let(root::removeView); setup = null
        playback.show(snapshot.plan, snapshot.rotation)
        if (!snapshot.paired) {
            if (pairing == null) {
                pairing = TextView(this).apply {
                    gravity = Gravity.CENTER
                    setTextColor(Color.WHITE); setBackgroundColor(Color.BLACK); textSize = 28f
                    contentDescription = getString(R.string.pairing_description)
                }.also { root.addView(it, FrameLayout.LayoutParams(-1, -1)) }
            }
            val code = snapshot.userCode?.replace("-", "")?.let { it.take(4) + "-" + it.drop(4) }
            pairing?.text = if (code != null) getString(R.string.pairing_instructions, code)
                else getString(R.string.connection_status, statusLabel(snapshot.status))
        } else {
            pairing?.let(root::removeView); pairing = null
            if (snapshot.plan is Plan.Neutral || playback.hasFailure || SystemClock.elapsedRealtime() < statusExpiresAt) updateStatus()
            else status?.visibility = View.GONE
        }
    }

    private fun showSetup() {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(48, 24, 48, 24); setBackgroundColor(Color.rgb(13, 28, 25))
        }
        column.addView(TextView(this).apply { setText(R.string.app_name); textSize = 32f; setTextColor(Color.WHITE) })
        column.addView(TextView(this).apply {
            setText(R.string.endpoint_instructions); textSize = 18f; setTextColor(Color.WHITE)
        })
        val endpoint = EditText(this).apply {
            setHint(R.string.endpoint_hint); contentDescription = getString(R.string.endpoint_description)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(); setTextColor(Color.WHITE); setHintTextColor(Color.LTGRAY)
            if (BuildConfig.DEBUG) setText(R.string.debug_endpoint)
        }
        column.addView(endpoint, LinearLayout.LayoutParams(640, -2))
        val error = TextView(this).apply { setTextColor(Color.rgb(255, 181, 171)); textSize = 16f }
        val connect = Button(this).apply {
            setText(R.string.connect)
            setOnClickListener {
                try {
                    runtime.configure(endpoint.text.toString())
                    error.setText(R.string.connecting)
                    isEnabled = false
                    runtime.start()
                } catch (_: IllegalArgumentException) {
                    error.setText(R.string.invalid_endpoint)
                } catch (_: Exception) {
                    android.util.Log.e("TeluniPlayer", "CONFIGURATION_FAILED")
                    error.setText(R.string.configuration_failed)
                }
            }
        }
        column.addView(connect, LinearLayout.LayoutParams(320, 96))
        column.addView(error)
        setup = column
        root.addView(column, FrameLayout.LayoutParams(-1, -1))
        connect.isFocusableInTouchMode = true
        connect.requestFocus()
    }

    private fun updateStatus() {
        val label = status ?: TextView(this).apply {
            setTextColor(Color.WHITE); setBackgroundColor(Color.argb(225, 18, 35, 30)); textSize = 18f
            setPadding(24, 12, 24, 12)
        }.also { status = it; root.addView(it, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.END)) }
        label.text = getString(R.string.status_card, statusLabel(last.status),
            getString(if (last.plan.degraded) R.string.media_degraded else if (playback.hasFailure) R.string.render_failed else when ((last.plan as? Plan.Neutral)?.condition) {
                PlaybackCondition.CLOCK_UNTRUSTED -> R.string.clock_untrusted
                PlaybackCondition.AUTHORIZATION_EXPIRED -> R.string.authorization_expired
                null -> R.string.playing_publication
                else -> R.string.awaiting_publication
            }))
        label.visibility = View.VISIBLE
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (last.paired && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)) {
            statusExpiresAt = SystemClock.elapsedRealtime() + 30_000
            updateStatus()
            main.removeCallbacks(hideStatus)
            main.postDelayed(hideStatus, 30_000)
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    private fun statusLabel(code: String): String = getString(when (code) {
        "CONNECTED" -> R.string.connected
        "PAIRING" -> R.string.awaiting_pairing
        "OFFLINE" -> R.string.offline
        "UNAUTHORIZED" -> R.string.unauthorized
        "INCOMPATIBLE" -> R.string.incompatible
        "STORAGE_ERROR" -> R.string.storage_error
        "STAGING_FAILED" -> R.string.staging_failed
        "UNLINKED" -> R.string.unlinked
        "SYNC_ERROR", "PLANNING_FAILED", "CHECKPOINT_FAILED" -> R.string.player_error
        else -> R.string.connecting
    })

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else hideLegacySystemBars()
    }

    @Suppress("DEPRECATION") // Android 8–10 have no WindowInsetsController.
    private fun hideLegacySystemBars() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }
}
