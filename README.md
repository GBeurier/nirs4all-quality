# nirs4all-quality

**Produit : `quali-nirs4all`** *(nom provisoire)* — un « studio miniature » pour **laboratoires d'analyse NIRS**, pensé pour des **laborantins néophytes en ML/stats**.

Il cache la complexité du pipeline **AR-NIRS** derrière un workflow guidé, pédagogique et « pré-mâché », et répond à cinq questions du quotidien :

1. Quels échantillons **re-passer à la NIRS** (et combien de répétitions) ?
2. Lesquels **envoyer à l'HPLC / chimie humide** (budget limité) pour progresser le plus ?
3. Le modèle recalibré est-il **assez bon / meilleur qu'avant** ?
4. En routine, **chaque prédiction est-elle fiable** ? (feu 🟢🟠🔴🔵)
5. Dans le temps, le modèle **dérive-t-il** — que re-mesurer pour le maintenir / le transférer ?

## Statut

Design initial (v1). Aucun code applicatif pour l'instant — voir **[`DESIGN.md`](DESIGN.md)** pour la conception produit complète (écrans, UX, contrat de décision, faisabilité, réutilisation des briques écosystème, revue Codex).

## Périmètre technique acté

- **WASM thin-shell uniquement** — moteur = `nirs4all-core` (aggregate) + `dag-ml` (runtime) + `nirs4all-methods`/libn4m (méthodes) + `nirs4all-io` / `nirs4all-formats` (WASM).
- **Pas** de dépendance à la lib Python `nirs4all`, **pas** de backend Python. *Aucune logique numérique en TypeScript* (doctrine « thin shell »).
- Cibles : **navigateur** (GitHub Pages) + **desktop** installable (Tauri, même code).
- Base de départ : dériver **`nirs4all-web/studio-lite`** (déjà ~80–90 % du workflow en WASM).

## Sources

- [`docs/pipeline_lab.png`](docs/pipeline_lab.png) — schéma AR-NIRS (3 phases : Avant calibration → Calibration → Exploitation & maintenance).
- [`docs/pipeline_lab.docx`](docs/pipeline_lab.docx) — spécification du pipeline.
