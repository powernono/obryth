import ExpoModulesCore

public class ObrythCoreModule: Module {
  private var vault: MobileVault?
  public func definition() -> ModuleDefinition {
    Name("ObrythCore")
    AsyncFunction("open") { (path: String) in
      self.vault = try MobileVault.open(path: path)
    }
    AsyncFunction("call") { (method: String, params: String) -> String in
      guard let vault = self.vault else { throw Exception(name: "VaultClosed", description: "Open the vault first") }
      return try vault.call(method: method, params: params)
    }
  }
}
