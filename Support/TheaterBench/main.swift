import Foundation

// The same recording and theater benchmarks used by the full test executable,
// with a small entry point so release optimization skips unrelated test cases.
@main
struct BenchMain {
    @MainActor static func main() {
        var arguments = Array(CommandLine.arguments.dropFirst())
        if arguments.first == "--bench" { arguments.removeFirst() }
        exit(BroadcastBench.main(arguments))
    }
}
