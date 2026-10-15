package app.obryth.core

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.obryth_mobile.MobileVault

class ObrythCoreModule : Module() {
  private var vault: MobileVault? = null
  override fun definition() = ModuleDefinition {
    Name("ObrythCore")
    AsyncFunction("open") { path: String -> vault = MobileVault.open(path) }
    AsyncFunction("call") { method: String, params: String ->
      (vault ?: error("Open the vault first")).call(method, params)
    }
  }
}
