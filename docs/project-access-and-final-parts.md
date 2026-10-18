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

The reviewed LS catalog has **36 final identities**. LQ2 STD and OPT each
have IB/OB × LH/RH; Primary has LH/RH only. **LQ2 LWR has STD/OPT × LH/RH,
with no IB/OB**. LWR STD retains Array cutting → LAM → Stacking → Screw
assembly → EOL → Visual → Packing. LWR OPT adds ICT before Array cutting.
**T1-2 Lower does not exist**; the owner corrected that earlier label.
Mistaken Lower and LWR IB/OB identities are archived, and their original
measurements remain readable without reassignment to STD/OPT. No official
product codes, quantities or machine assets are generated.

Parts menus use **family → model → final variant** groups. Process Map starts
with model groups collapsed. Selecting a model selects all its final variants.
Variants with identical recorded process steps, route edges, machines, materials
and input quantities share one map row. Differences in these records retain
separate rows, including when the material/machine display layers are hidden.
This visual grouping never merges stored object IDs or measurements.

Progress opens the model groups and selects exactly one final part. Group
headings contain no multi-select checkbox; the group selection button chooses
one of its final variants. The Parts menu, bottom selector and displayed route
use the same selection, including when changing lines or reading historical
parent-model observations. Part-scoped material relationships are checked
before selecting process steps, as well as when rendering their context. Hourly output also uses final identities;
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


The 2026-10-18 owner review corrected Primary to LH/RH only. The four mistaken
IB/OB identities remain archived with `replacedByPartId` links so saved map
selections resolve to the reviewed parts. Original measurements remain on their
original IDs; no historical quantities or targets are copied or summed. Retired
classifications with observations remain selectable as **기존 분류 (원본 실적)**.

LDM final and intermediate parts now have explicit `LDM → produces → Part`
line-context links. These carry no output quantity. Part details follow the
existing line escalation groups, Leader/Supervisor membership, line manager and
recorded `reports_to` chain. No individual station assignment or new title is
inferred. Global Library follows these same visible ontology links. Unlinked
parts and parts with conflicting line links retain unknown/ambiguous contacts.


T1XL has exactly two finished parts, **T1XL LH** and **T1XL RH**. Their original
IDs and LH/RH observations remain unchanged; Upper/Lower PCB and assembly
components remain intermediate parts. Original long labels are retained as
`sourcePartName` and accepted for exact-name Progress import.

Only G65 Upper/Lower × RH/LH have numbered components **1** and **2**. Each
Integration consumes one of each, scoped to that exact final part, and produces
its intermediate `main` assembly. The existing LAM operation connects this
assembly to the final identity. Existing Upper RH component and assembly IDs
are reused. Cornering, Side Marker and Jewelry Piece do not receive this BOM.
Router per-panel yields remain separate and unchanged; no LH yield, additional
material, machine asset or measured output is invented.
