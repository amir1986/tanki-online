# Third-party assets

All assets in this folder are redistributed under their original licenses. They are downloaded and prepared by
`node tools/assets.mjs` (textures and models are resized / simplified for real-time use).

## Textures — ambientCG (CC0 1.0)

PBR texture sets from https://ambientcg.com (Public Domain, CC0). Each `textures/<name>/source.json` records the
original asset id (for example `Grass004`, `Concrete034`, `Metal032`).

## HDRI skies — Poly Haven (CC0 1.0)

Sky photographs from https://polyhaven.com/hdris, 1k `.hdr` files: `kloofendal_48d_partly_cloudy_puresky`,
`farm_field_puresky`, `qwantani_noon_puresky`, `qwantani_sunset_puresky`, `kloofendal_overcast_puresky`,
`snow_field_puresky`, `industrial_sunset_puresky`, `belfast_sunset_puresky`.

## Props — Poly Haven (CC0 1.0)

Scanned models from https://polyhaven.com/models (barrels, crates, jerrycan, tyre, boulders, trees, road barriers,
pipes, trash can, ladder, compressor, dead trunk, branches...). `models/index.json` lists the source page and authors
of every model.

## Tank — OpenGameArt (CC0 1.0)

"Abrams tank" by Sketlux, https://opengameart.org/content/abrams-tank (CC0). Split into `tank_hull.glb`,
`tank_turret.glb` and `tank_gun.glb` with `tools/blender/split_tank.py`.

## Music — OpenGameArt (CC0 1.0)

- "Chill Main Menu Music" by WeaponGuy — https://opengameart.org/content/chill-main-menu-music
- "Battle Theme A" by JaidynReiman — https://opengameart.org/content/battle-theme-a
- "Let the Games Begin" by Tozan — https://opengameart.org/content/let-the-games-begin-0
- "The Rush" by tebruno99 — https://opengameart.org/content/the-rush
