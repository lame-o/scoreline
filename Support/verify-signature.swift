// Checks an update archive's EdDSA signature against a public key: the check
// Sparkle makes before installing an update. release.sh runs it with the
// app's SUPublicEDKey, so a release signed with the wrong key never ships.
//   swift Support/verify-signature.swift <archive> <signature> <public key>
import CryptoKit
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 4,
      let archive = FileManager.default.contents(atPath: arguments[1]),
      let signature = Data(base64Encoded: arguments[2]),
      let keyData = Data(base64Encoded: arguments[3]),
      let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData)
else {
    FileHandle.standardError.write(Data("usage: verify-signature.swift <archive> <signature> <public key>\n".utf8))
    exit(64)
}
exit(publicKey.isValidSignature(signature, for: archive) ? 0 : 1)
