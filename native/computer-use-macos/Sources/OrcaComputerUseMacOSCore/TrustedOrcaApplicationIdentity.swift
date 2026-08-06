public func isTrustedOrcaApplicationBundleId(_ bundleId: String) -> Bool {
    bundleId == "com.stablyai.orca" ||
        bundleId == "com.teal.orcateal" ||
        bundleId.hasPrefix("com.stablyai.orca.dev.") ||
        bundleId == "com.github.Electron"
}
