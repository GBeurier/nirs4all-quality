# nirs4all-quality

### ▶ Application en ligne : **https://quali.nirs4all.org/**

**Produit : `quali-nirs4all`** *(nom provisoire)* — un « studio miniature » pour **laboratoires d'analyse NIRS**, pensé pour des **laborantins néophytes en ML/stats**.

Il cache la complexité du pipeline **AR-NIRS** derrière un workflow guidé, pédagogique et « pré-mâché », et répond à cinq questions du quotidien :

1. Quels échantillons **re-passer à la NIRS** (et combien de répétitions) ?
2. Lesquels **envoyer à l'HPLC / chimie humide** (budget limité) pour progresser le plus ?
3. Le modèle recalibré est-il **assez bon / meilleur qu'avant** ?
4. En routine, **chaque prédiction est-elle fiable** ? (feu 🟢🟠🔴🔵)
5. Dans le temps, le modèle **dérive-t-il** — que re-mesurer pour le maintenir / le transférer ?

## Statut

Application WASM fonctionnelle ([`app/`](app/README.md)) : exploration des données (spectres / PCA / **répétitions**), santé des données (preuves calculées : T²/Q, bruit par bande…), sélection HPLC, **calibration réelle (libn4m WASM)**, prédiction avec fiabilité, maintenance. Bilingue FR/EN, import CSV, persistance IndexedDB, exports CSV/`.n4a`. Conception complète dans **[`DESIGN.md`](DESIGN.md)**.

## Déploiement (GitHub Pages)

Le site est publié depuis la branche **`gh-pages`** (build préconstruit — les packages UI et agrégat sont épinglés sur npm, mais la construction utilise les modules WASM préparés dans `nirs4all-web/web-app`; le build se fait donc encore en local). Pour redéployer après une modification :

```bash
cd app
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
npm run deploy          # build + push de app/dist vers gh-pages
```

URL : **https://quali.nirs4all.org/**

## Périmètre technique acté

- **WASM thin-shell uniquement** — moteur = `nirs4all-core` (aggregate) + `dag-ml` (runtime) + `nirs4all-methods`/libn4m (méthodes) + `nirs4all-io` / `nirs4all-formats` (WASM).
- **Pas** de dépendance à la lib Python `nirs4all`, **pas** de backend Python. *Aucune logique numérique en TypeScript* (doctrine « thin shell »).
- Cibles : **navigateur** (GitHub Pages) + **desktop** installable (Tauri, même code).
- Base de départ : réutiliser les contrats du client actif **`nirs4all-web/web-app`**.

## Sources

- [`docs/pipeline_lab.png`](docs/pipeline_lab.png) — schéma AR-NIRS (3 phases : Avant calibration → Calibration → Exploitation & maintenance).
- [`docs/pipeline_lab.docx`](docs/pipeline_lab.docx) — spécification du pipeline.
