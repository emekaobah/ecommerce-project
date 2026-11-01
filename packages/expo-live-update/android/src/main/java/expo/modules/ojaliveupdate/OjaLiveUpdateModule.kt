package expo.modules.ojaliveupdate

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OjaLiveUpdateModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OjaLiveUpdate")

    Function("show") { view: LiveUpdateRecord -> LiveUpdateNotifier(context).show(view) }

    Function("cancel") { id: String, revision: Double -> LiveUpdateNotifier(context).cancel(id, revision.toLong()) }

    Function("cancelAll") { LiveUpdateNotifier(context).cancelAll() }
  }
}
