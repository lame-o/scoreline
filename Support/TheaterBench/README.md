# Recording benchmarks

`run.sh` builds the existing recording adapters, meters and painters with `-Osize -wmo`, using a small entry point instead of optimizing the unrelated regression tests. It runs the same benchmark implementation as `test.sh --bench`; it does not substitute a simulated engine. The output is `build/ScorelineBench`.

```sh
./Support/TheaterBench/run.sh --theater engine basketball --real --event=401909896 --twice
./build/ScorelineBench --theater engine soccer --real --event=401879249 --twice
./build/ScorelineBench --theater engine football --real --event=401859185 --twice
./build/ScorelineBench --theater engine-cost basketball
```

Run timing comparisons sequentially after other builds finish. Use `--twice` to check deterministic plans; mismatches and missing recordings fail the command. `--real` reads the local recorder's files, then falls back to checked-in fixtures for events that are absent. Synthetic fixtures remain labeled in their directory names. The complete functional suite still runs through `./test.sh`.
