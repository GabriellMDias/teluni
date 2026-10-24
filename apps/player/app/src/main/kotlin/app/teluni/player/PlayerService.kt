package app.teluni.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder

class PlayerService : Service() {
    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("player", getString(R.string.service_channel), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(this, 0, Intent(this, PlayerActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        startForeground(1, Notification.Builder(this, "player").setSmallIcon(R.drawable.teluni_mark)
            .setContentTitle(getString(R.string.app_name)).setContentText(getString(R.string.service_status))
            .setContentIntent(open).setOngoing(true).build())
        (application as PlayerApplication).runtime.start()
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        (application as PlayerApplication).runtime.start()
        return START_STICKY
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
