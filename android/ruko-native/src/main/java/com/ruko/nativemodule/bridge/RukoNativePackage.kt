package com.ruko.nativemodule.bridge

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registration point for the native layer.
 *
 * `mobile/` adds a single line to `MainApplication.kt`:
 *
 *     packages.add(RukoNativePackage())
 *
 * That, plus two lines in `settings.gradle`, is the entire integration surface
 * between Puneesh's module and Aishwarya's app. See android/README.md.
 */
class RukoNativePackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(RukoNativeModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
