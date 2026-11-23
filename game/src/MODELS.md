# SOLMAR — vendored 3D models

All models are loaded offline from `game/src/models/` with the vendored
`GLTFLoader.js` (three.js r147, MIT). No model is downloaded at runtime.
Trees, street props and landmarks are still built procedurally in
`render3d.js` — see the notes at the bottom.

## Cars (GLB, loaded by `render3d.js`)

| File | Model | Source | Licence |
| --- | --- | --- | --- |
| `kenney-sedan.glb` | Sedan | Kenney Car Kit — https://kenney.nl/assets/car-kit | CC0 1.0 (public domain) |
| `kenney-sedan-sports.glb` | Sports sedan | Kenney Car Kit — https://kenney.nl/assets/car-kit | CC0 1.0 |
| `kenney-suv.glb` | SUV | Kenney Car Kit — https://kenney.nl/assets/car-kit | CC0 1.0 |
| `kenney-taxi.glb` | Taxi | Kenney Car Kit — https://kenney.nl/assets/car-kit | CC0 1.0 |
| `kenney-truck.glb` | Pickup | Kenney Car Kit — https://kenney.nl/assets/car-kit | CC0 1.0 |
| `kenney-police.glb` | Police car | Kenney Car Kit — https://kenney.nl/assets/car-kit | CC0 1.0 |
| `CesiumMilkTruck.glb` | Milk delivery truck | Khronos glTF-Sample-Models, `2.0/CesiumMilkTruck` — https://github.com/KhronosGroup/glTF-Sample-Models | CC-BY 4.0, donated by Cesium |
| `Textures/colormap.png` | Shared paint texture for the Kenney cars | Kenney Car Kit (same source as above) | CC0 1.0 |

Attribution (CC-BY): the milk truck model is "CesiumMilkTruck" by Cesium,
licensed under Creative Commons Attribution 4.0 International
(http://creativecommons.org/licenses/by/4.0/). The Kenney models are CC0 —
no attribution is required, but credit to Kenney (https://kenney.nl) is
given here anyway.

## People (GLB, loaded by `render3d.js`)

| File | Model | Source | Licence |
| --- | --- | --- | --- |
| `human-player.glb` | Realistic clothed man (MakeHuman) | Periliminal.Space repo, `godot/assets/models/metahuman_player.glb` — https://github.com/joeholloway445-maker/Periliminal.Space | CC0 1.0 |

The model was generated with **MakeHuman / MPFB 2** (makehumancommunity.org)
from the MakeHuman Community CC0 system-asset packs (skin, shirt, pants,
shoes) and baked to GLB by that project; their ATTRIBUTION.md records it as
CC0. It is used for the player and for all 24 pedestrians, with the shirt
and trousers re-tinted per person and a procedural hair cap added (the model
is bald). It has no skeleton, so walk motion is a whole-body bob and lean
instead of swinging limbs. The female variant (`npc_human.glb`, same source)
was evaluated but not used: 28,146 vertices per pedestrian was too heavy
for 24 of them (the male model is 6,318).

Rejected: the ready-made `human.glb` shipped by kunalkushwaha/vsim
(MakeHuman, CC0) is an **untextured nude** body — unusable in the game.

## Buildings (GLB, loaded by `render3d.js`)

| File | Model | Source | Licence |
| --- | --- | --- | --- |
| `buildings/building-a.glb` … `building-h.glb` | Mid-rise commercial blocks | Kenney City Kit (Commercial) — https://kenney.nl/assets/city-kit-commercial | CC0 1.0 |
| `buildings/building-skyscraper-a.glb` … `building-skyscraper-e.glb` | Glass towers | Kenney City Kit (Commercial) — same source | CC0 1.0 |
| `buildings/building-type-a.glb` … `building-type-f.glb` | Suburban houses | Kenney City Kit (Suburban) — https://kenney.nl/assets/city-kit-suburban | CC0 1.0 |
| `buildings/Textures/colormap.png` | Shared paint texture for the city-kit models | Kenney City Kit (Commercial) | CC0 1.0 |

Tall downtown blocks get a tower, the rest a mid-rise block, the lowest
ones a suburban house (picked by a hash of the block position, so the
skyline is deterministic). Each model is stretched to its block's footprint
and height. The procedural box body, roof slab, parapet rim and safehouse
pyramid are removed on swap; rooftop clutter, balconies, antennas,
shopfronts and landmarks stay in place on the same footprint and height.
Note the city-kit colormap is a different file from the car-kit's
`models/Textures/colormap.png`, so the buildings live in their own
`models/buildings/` folder with their own `Textures/` next to them.

## Loader

`game/src/GLTFLoader.js` is the three.js r147 UMD GLTFLoader
(https://unpkg.com/three@0.147.0/examples/js/loaders/GLTFLoader.js),
MIT-licensed, used unchanged against the vendored three.js r149 core.
It is loaded as a plain script in `game/index.html` before `main.js`.

## What is still procedural, and why

- **Trees, street props, landmarks:** built procedurally in `render3d.js`
  (palms, lamps, benches, umbrellas, containers, hospital cross, bank
  columns, garage sign). They already read well and no realistic GLB was
  needed for them.

No Rockstar / GTA assets are used anywhere in this game. Every model
above is from a free, openly licensed source listed here.
