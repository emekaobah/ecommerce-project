package expo.modules.ojaliveupdate

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat

/**
 * Draws a `LiveUpdateView`: a promoted ongoing notification on Android 16, an ongoing one that
 * updates in place on older versions. Standard notification parts only, as Android forbids custom
 * views in a Live Update. Everything here is silent: the normal pushes do the alerting.
 */
internal class LiveUpdateNotifier(private val context: Context) {
  private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  private val revisions = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun show(view: LiveUpdateRecord) {
    if (!claim(view.id, view.revision.toLong())) return
    createChannel()
    val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) liveUpdate(view) else olderNotification(view)
    manager.notify(TAG_PREFIX + view.id, NOTIFICATION_ID, notification)
  }

  fun cancel(id: String, revision: Long) {
    if (claim(id, revision)) manager.cancel(TAG_PREFIX + id, NOTIFICATION_ID)
  }

  fun cancelAll() {
    manager.activeNotifications
      .filter { it.tag?.startsWith(TAG_PREFIX) == true }
      .forEach { manager.cancel(it.tag, it.id) }
    revisions.edit().clear().apply()
  }

  /** Whether this is the newest this id has been asked to show: pushes can arrive out of order, and a late one mustn't undo a newer one. */
  private fun claim(id: String, revision: Long): Boolean {
    if (revision < revisions.getLong(id, Long.MIN_VALUE)) return false
    val editor = revisions.edit().putLong(id, revision)
    // Only the newest matter: an old id's pushes have long stopped.
    if (revisions.all.size >= MAX_REVISIONS) {
      revisions.all.entries.minByOrNull { it.value as Long }?.let { editor.remove(it.key) }
    }
    editor.apply()
    return true
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    // Default importance, so it shows on a Lock Screen that hides silent notifications. No sound
    // or vibration, so that's all it does. Android 16 won't promote from a minimum-importance channel.
    val channel = NotificationChannel(CHANNEL_ID, "Orders on Lock Screen", NotificationManager.IMPORTANCE_DEFAULT).apply {
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  @RequiresApi(Build.VERSION_CODES.BAKLAVA)
  private fun liveUpdate(view: LiveUpdateRecord): Notification {
    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(iconOf(view.icon))
      .setContentTitle(view.title)
      .setContentText(view.text)
      .setSubText(view.subText)
      .setContentIntent(opening(view))
      .setColor(colorOf(view.color))
      .setOngoing(view.ongoing)
      .setAutoCancel(!view.ongoing)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_STATUS)
      .setTimeoutAfter(view.timeoutMs.toLong())
      .setStyle(view.progress?.let { progressStyle(it) } ?: Notification.BigTextStyle().bigText(view.text))
    view.chip?.let { builder.setShortCriticalText(it) }
    view.countdownTo?.let { builder.setWhen(it.toLong()).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true) }
    if (view.ongoing) {
      // What `setRequestPromotedOngoing` sets, which only Android 16 QPR2 (36.1) on has.
      builder.addExtras(Bundle().apply { putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true) })
      // Android 16's first release asks for colorized instead, and 36.1 on refuses it.
      if (Build.VERSION.SDK_INT_FULL < Build.VERSION_CODES_FULL.BAKLAVA_1) builder.setColorized(true)
    }
    return builder.build()
  }

  @RequiresApi(Build.VERSION_CODES.BAKLAVA)
  private fun progressStyle(progress: ProgressRecord): Notification.ProgressStyle {
    val style = Notification.ProgressStyle()
      .setStyledByProgress(progress.styledByProgress)
      .setProgressSegments(
        progress.segments.map { segment ->
          Notification.ProgressStyle.Segment(segment.length).apply { segment.color?.let { setColor(colorOf(it)) } }
        }
      )
      .setProgressPoints(progress.points.map { Notification.ProgressStyle.Point(it) })
      .setProgress(progress.position)
    progress.tracker?.let { style.setProgressTrackerIcon(Icon.createWithResource(context, iconOf(it))) }
    return style
  }

  private fun olderNotification(view: LiveUpdateRecord): Notification {
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(iconOf(view.icon))
      .setContentTitle(view.title)
      .setContentText(view.text)
      .setSubText(view.subText)
      .setContentIntent(opening(view))
      .setColor(colorOf(view.color))
      .setOngoing(view.ongoing)
      .setAutoCancel(!view.ongoing)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setTimeoutAfter(view.timeoutMs.toLong())
    val bar = view.olderBar
    if (bar != null) builder.setProgress(bar.max, bar.current, false) else builder.setStyle(NotificationCompat.BigTextStyle().bigText(view.text))
    view.countdownTo?.let { builder.setWhen(it.toLong()).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true) }
    return builder.build()
  }

  private fun opening(view: LiveUpdateRecord): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(view.url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, view.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun colorOf(color: ThemedColorRecord): Int {
    val night = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    return Color.parseColor(if (night) color.dark else color.light)
  }

  private fun iconOf(name: String): Int = when (name) {
    "clock" -> R.drawable.oja_live_update_clock
    "box" -> R.drawable.oja_live_update_box
    "truck" -> R.drawable.oja_live_update_truck
    "store" -> R.drawable.oja_live_update_store
    "check" -> R.drawable.oja_live_update_check
    "info" -> R.drawable.oja_live_update_info
    "x" -> R.drawable.oja_live_update_x
    else -> R.drawable.oja_live_update_bag
  }

  private companion object {
    const val CHANNEL_ID = "oja_live_updates"
    const val PREFERENCES = "oja.live-updates"
    const val TAG_PREFIX = "oja.live-update:"
    const val NOTIFICATION_ID = 1
    const val MAX_REVISIONS = 64
    const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
  }
}
