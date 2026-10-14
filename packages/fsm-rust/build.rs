// Generates the orm models of the document set of the root schema/dbspec-set.json into OUT_DIR (docs/plans/fsm-v1.md, C-2). The rust package has no
// examples/model/ directory: this build script is its model generator, the declared difference of rust in config/layout.yml.
// The scanned examples/ directory names the model calls of examples/persist.rs, so a call that the model lacks fails the build.
fn main() {
    polyspec_orm_build::Builder::set("../../schema/dbspec-set.json")
        .scan("examples")
        .generate();
}
