# Changelog

## [3.0.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v2.0.1...v3.0.0) (2026-09-23)


### ⚠ BREAKING CHANGES

* **commands:** suggest /perm arguments and rename reset to forget
* **config:** name each config key after its /perm row
* **workspace:** gate auto-approvals by project scope

### Features

* **commands:** suggest /perm arguments and rename reset to forget ([2cc932e](https://github.com/felipeadeildo/pi-ask-permission/commit/2cc932eef7a6e48adb775fec444be8d8782b4c6c))
* **config:** name each config key after its /perm row ([a9a2738](https://github.com/felipeadeildo/pi-ask-permission/commit/a9a273824e3d83b5a1903cf8c548df995f672e8f))
* **dialog:** show the diff an edit or write would make ([1222ca9](https://github.com/felipeadeildo/pi-ask-permission/commit/1222ca9dd3aa4bc30d53991de6cf79caced7e4d6))
* **events:** announce each decision and let other tools describe what they touch ([8dad96d](https://github.com/felipeadeildo/pi-ask-permission/commit/8dad96dc21fdad6f4b557743eceeb940d899add2))
* **readonly:** accept for loops and newline-separated commands ([8ce81bf](https://github.com/felipeadeildo/pi-ask-permission/commit/8ce81bf1d9f1c6da3b86cc0fe4240d08eeda70c0))
* **session:** keep the mode and this session's always yes across reloads and resumes ([264e815](https://github.com/felipeadeildo/pi-ask-permission/commit/264e815adf597cefd0c84b28e3f7e0eb07b0c12d))
* **workspace:** gate auto-approvals by project scope ([cfb7739](https://github.com/felipeadeildo/pi-ask-permission/commit/cfb773977b29950964a8be058963522f94dfcc3b))


### Bug Fixes

* **always-yes:** add to the saved file instead of overwriting it, now always-yes.json ([ede87d4](https://github.com/felipeadeildo/pi-ask-permission/commit/ede87d428810125cdf49bcf45f62ed2bbff88f85))
* **bash:** keep pi's shell settings in the timed bash override ([8bb8d2b](https://github.com/felipeadeildo/pi-ask-permission/commit/8bb8d2be0a04b88123b9fb409b168c746abc5e43))
* **config:** load config.json when a session starts, not when pi loads the extension ([79ddf75](https://github.com/felipeadeildo/pi-ask-permission/commit/79ddf75f4681318c2a6b4eb2fd2bfbdb9ea4c62f))
* **config:** replace the rename warnings with one info line ([dcbfdee](https://github.com/felipeadeildo/pi-ask-permission/commit/dcbfdeef5a0ca87ae59f219c71ada9d6cd979c78))
* **dialog:** put the title's space after the title, not before the corner ([1dce5a0](https://github.com/felipeadeildo/pi-ask-permission/commit/1dce5a084859a66b8b4b460f17e0e162f11d1b41))
* **workspace:** count powershell as outside and decide calls through tool adapters ([1216555](https://github.com/felipeadeildo/pi-ask-permission/commit/12165558c53d6834e1da09212484a97481119028))

## [2.0.1](https://github.com/felipeadeildo/pi-ask-permission/compare/v2.0.0...v2.0.1) (2026-09-21)


### Bug Fixes

* **readonly:** allow git branch and git remote listings ([0681ea4](https://github.com/felipeadeildo/pi-ask-permission/commit/0681ea4670f95d3547e17e4805bdf6561340e8bb))

## [2.0.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.2.0...v2.0.0) (2026-09-21)


### ⚠ BREAKING CHANGES

* `yolo` is removed from config.json. Set `mode` to "manual", "accept-edits", or "yolo" instead.

### Features

* replace the persisted yolo flag with session modes ([3380e6c](https://github.com/felipeadeildo/pi-ask-permission/commit/3380e6ce760ef672c66621fecde2744b77a8aadd))


### Bug Fixes

* **readonly:** accept benign redirects, sed address ranges, and quoted substitutions ([fe4bb1e](https://github.com/felipeadeildo/pi-ask-permission/commit/fe4bb1e1cbb47200a71770ec5434c0430f76007d))

## [1.2.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.1.0...v1.2.0) (2026-09-20)


### Features

* default AI approvals to a policy preset and show why the judge asked ([7843c43](https://github.com/felipeadeildo/pi-ask-permission/commit/7843c4351cb8cd600199e81db0d846c2cd078439))
* delegate approvals to a judge model ([51bb31b](https://github.com/felipeadeildo/pi-ask-permission/commit/51bb31b3d1c120d3a8d52ada32c17adbb248681f))
* show a card for every judge decision ([a429e71](https://github.com/felipeadeildo/pi-ask-permission/commit/a429e71fc203ba74a4a1c5287ffa99731093b84a))
* warn when AI approvals are on without a policy ([48dc772](https://github.com/felipeadeildo/pi-ask-permission/commit/48dc7727f8c6622b7f796079a53ec260644b7be6))


### Bug Fixes

* render judge entries persisted before per-turn grouping ([f0255d9](https://github.com/felipeadeildo/pi-ask-permission/commit/f0255d9f5c05b94df2c9e00b335de3d75919d688))
* show a judge card as soon as the judge decides ([cc84f6f](https://github.com/felipeadeildo/pi-ask-permission/commit/cc84f6f08fbe2c4f02cec044fd41c2a01cf467cd))
* size the judge card columns to the card itself ([a2a57a1](https://github.com/felipeadeildo/pi-ask-permission/commit/a2a57a11160154721136550ec4ca7b4ca0e91616))
* surface judge decisions and stop reporting rate limits as timeouts ([eb1f511](https://github.com/felipeadeildo/pi-ask-permission/commit/eb1f51194b93883f8fb21e32e23daff8c97960d4))

## [1.1.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.0.1...v1.1.0) (2026-09-20)


### Features

* auto-allow read-only bash commands ([21c36a8](https://github.com/felipeadeildo/pi-ask-permission/commit/21c36a838196254d4dbf65be73bc2a791c04bff9))

## [1.0.1](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.0.0...v1.0.1) (2026-09-20)


### Bug Fixes

* skip the generated changelog and allow a manual publish ([31f5478](https://github.com/felipeadeildo/pi-ask-permission/commit/31f5478868fd52130e19f01bbf4bbda58b14c7d7))

## 1.0.0 (2026-09-20)


### Features

* add pi-ask-permission, a three-way permission dialog with note followups ([55b603b](https://github.com/felipeadeildo/pi-ask-permission/commit/55b603b0e5c7ef049d4b614e7d3b6d89b9fcc12e))
* block an edit that cannot apply before the permission dialog ([5faaade](https://github.com/felipeadeildo/pi-ask-permission/commit/5faaadeaaad359a90dd4dede499e5536aeb2bafc))
* hold the dialog while the user is typing ([52fcfea](https://github.com/felipeadeildo/pi-ask-permission/commit/52fcfea4764e5d1042186d2c694516a8d7c683f2))
* keep a per-row note draft while arrowing the permission dialog ([84d684f](https://github.com/felipeadeildo/pi-ask-permission/commit/84d684ffdc246cd3f10a2fee68cfbfa12d75998f))
* paste images and long text into the permission note ([9dbc842](https://github.com/felipeadeildo/pi-ask-permission/commit/9dbc842110b70f13176e14c2e18ebbf2358548a8))
* scope always-yes grants to the session, the project, or everywhere ([d8aa4d2](https://github.com/felipeadeildo/pi-ask-permission/commit/d8aa4d23e12ec731d8f2102a1dffcd5fb2603147))


### Bug Fixes

* stop counting approval time in the bash Took line ([8e1a30c](https://github.com/felipeadeildo/pi-ask-permission/commit/8e1a30cfba7b9fea6ea5537ef24dd956c698e419))


### Miscellaneous Chores

* point the npm homepage at the pi gallery ([17e49bc](https://github.com/felipeadeildo/pi-ask-permission/commit/17e49bcfc02fb3737e65a2a0b7b534f4a66978c5))
