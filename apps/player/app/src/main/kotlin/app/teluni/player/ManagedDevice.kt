package app.teluni.player

import android.app.Activity
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter

class PlayerAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) { ManagedDevice.configure(context) }
}

internal object ManagedDevice {
    fun configure(context: Context): Boolean {
        val policy = context.getSystemService(DevicePolicyManager::class.java)
        if (!policy.isDeviceOwnerApp(context.packageName)) return false
        val admin = ComponentName(context, PlayerAdminReceiver::class.java)
        policy.setLockTaskPackages(admin, arrayOf(context.packageName))
        policy.addPersistentPreferredActivity(admin, IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }, ComponentName(context, PlayerActivity::class.java))
        return true
    }

    fun enter(activity: Activity) {
        if (configure(activity)) activity.startLockTask()
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && ManagedDevice.configure(context)) {
            context.startActivity(Intent(context, PlayerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
