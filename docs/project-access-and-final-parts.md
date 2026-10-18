# Project access and final-part measurements

Open the site normally to browse. **나만 보기 · 편집** opens Supabase account
sign-in. Inside an owned project, **공개 범위 · 비밀번호** offers three modes:

- **공개**: anyone can read; edits require the owner account.
- **비밀번호**: the project name is listed, and its contents require its password.
- **나만 보기**: the project is absent from public reads; the owner account can open it.

The default remains public until the owner changes it. Passwords are hashed on
the server. Successful password entry creates an eight-hour, read-only session
held in the current browser tab. Saving access settings revokes previous view
sessions. Password attempts are limited to ten per project per minute. Private
projects cannot be unlocked with a project password. Protection applies to
direct Supabase RPCs, production APIs and exclusive project objects/relations in
the Global Library. Canonical objects shared with a public project remain public;
an object's existing `local_only` classification always remains private.

Progress and hourly output now select a **최종 파츠** such as `LQ2 STD IB RH`.
Use **＋ 최종 파츠** to register an actual IB/OB, RH/LH combination and optional
official model code. Confirm that the selected base route is shared. Each final
part has its own object ID, observations, hourly measurements and Unit Time.
Neither common process steps nor identical times merge different final parts.

The migrations register **IB RH, IB LH, OB RH, OB LH** for every LQ2 model
(STD, OPT, LWR and primary light source), RH/LH for the other recorded LS models,
and STD/OPT × RH/LH for the separate **T1-2 Lower** model. The complete catalog
contains 42 final identities. Existing identities and measurements are reused;
official product codes and quantities are not generated. T1-2 Lower has no
confirmed route: its children show **공정 미등록**, and neither Base nor Uplevel
routes are assigned to it. Hourly quantities can still be entered per Lower part.

Parts menus use **family → model → final variant** groups. Process Map starts
with model groups collapsed. Selecting a model selects all its final variants.
Variants with identical recorded process steps, route edges, machines, materials
and input quantities share one map row. Differences in these records retain
separate rows, including when the material/machine display layers are hidden.
This visual grouping never merges stored object IDs or measurements.

Progress opens the model groups and selects exactly one final part. Its selector
and the Parts menu stay synchronized. Hourly output also uses final identities;
different IB/OB and RH/LH quantities remain independent. Saved parent-model
selections expand into their final children.
Higher-level models remain in the ontology and existing higher-level records
remain separately selectable as **기존 상위 모델 (상세 미분류)**. They are never
distributed into RH/LH or IB/OB, or added to child counts. New observations and
targets require a leaf part. Components remain supported for existing component
output workspaces such as SMT.

Progress original text remains in its private source record and History. Older
Progress Events are normalized when read so their legacy missing status or raw
text field cannot block later project edits; their original source is retained.
Current Firebase archives remain unchanged.
