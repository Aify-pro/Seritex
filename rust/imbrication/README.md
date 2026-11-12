# seritex-imbrication

Moteur d'imbrication de Seritex. Il lit une entrée JSON
`seritex.imbrication/v1` (pièces, tissu, contraintes), calcule le tracé
avec [sparrow](https://github.com/JeroenGar/sparrow) 0.3.0 (MIT) au-dessus de
[jagua-rs](https://github.com/JeroenGar/jagua-rs) 1.0.0 (MPL-2.0), et rend la
position de chaque pièce. Documentation complète : `docs/imbrication.md`.

## Contenu

| Fichier | Rôle |
|---|---|
| `src/contrat.rs` | Types du contrat JSON (entrée, sortie, erreurs). |
| `src/lib.rs` | `imbriquer()` : contrôles d'entrée, conversion vers jagua-rs, appel de `sparrow::optimizer::optimize`, conversion des placements vers le contour d'origine. |
| `src/terminateur.rs` | Règle d'arrêt : budget d'effort (reproductible) ou de temps, temps maximal, fichier d'annulation. |
| `src/main.rs` | Programme : JSON sur l'entrée standard, JSON sur la sortie standard. |
| `tests/conversion.rs` | Coordonnées éloignées de l'origine, pièces retournées, marges, erreurs. |

## Construire

La version de Rust est figée par `rust-toolchain.toml` (rustup l'installe
au premier appel).

```bash
cargo build --release                          # binaire natif (banc d'essai)
cargo build --release --target wasm32-wasip1   # module embarqué dans Seritex
cargo test --release                           # le mode debug de sparrow est très lent
```

Dans Seritex, utiliser `npm run build:imbrication`, qui compile le module,
le copie dans `src/lib/imbrication/moteur/` et met à jour `version.json` et
`THIRD_PARTY_LICENSES`.

## Utiliser en ligne de commande

```bash
./target/release/seritex-imbrication < entree.json > sortie.json
```

Le programme répond toujours en JSON, y compris en cas d'erreur
(`"statut": "echec"`, avec un message en français).

## Points d'attention

- sparrow n'est pas publié sur crates.io : il est référencé par son dépôt
  git, figé sur le commit du tag v0.3.0. Pour monter de version, changer
  `rev` dans `Cargo.toml`, vérifier dans son code ce qui a changé (orientations,
  symétries, format), puis relancer les tests et le banc d'essai.
- sparrow 0.3.0 n'essaie jamais de symétrie : une pièce `miroir` est donc
  retournée par ce module avant le calcul.
- Le moteur garde l'espacement aussi contre les bords du tissu.
