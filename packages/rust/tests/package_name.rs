// The name of the crate (S-407). Every polyspec crate names its product, polyspec-<product>, as polyspec-orm does, and consumers name
// the crate in their Cargo.toml by its git tag; the first release fixes the name, so it is polyspec-fsm, with the lib polyspec_fsm.

#[test]
fn crate_is_named_polyspec_fsm() {
    assert_eq!(env!("CARGO_PKG_NAME"), "polyspec-fsm");
}
