import OrcaComputerUseMacOSCore
import XCTest

final class TrustedOrcaApplicationIdentityTests: XCTestCase {
    func testAcceptsPackagedOrcaDistributionsAndDevelopmentWrappers() {
        XCTAssertTrue(isTrustedOrcaApplicationBundleId("com.stablyai.orca"))
        XCTAssertTrue(isTrustedOrcaApplicationBundleId("com.teal.orcateal"))
        XCTAssertTrue(isTrustedOrcaApplicationBundleId("com.stablyai.orca.dev.abc123"))
        XCTAssertTrue(isTrustedOrcaApplicationBundleId("com.github.Electron"))
    }

    func testRejectsOtherApplicationsAndLookalikeBundleIds() {
        XCTAssertFalse(isTrustedOrcaApplicationBundleId("com.apple.Terminal"))
        XCTAssertFalse(isTrustedOrcaApplicationBundleId("com.teal.orcateal.dev"))
        XCTAssertFalse(isTrustedOrcaApplicationBundleId("com.stablyai.orca.evil"))
    }
}
