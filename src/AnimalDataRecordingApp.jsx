import React, { useMemo, useState } from "react";

const BREEDS = ["Murrah buffalo", "Nili-Ravi buffalo"];
const SEX_OPTIONS = ["Female", "Male"];
const STATUS_OPTIONS = ["Active (present in herd)", "Dead", "Culled"];
const FEMALE_TABS = ["pedigree", "reproduction", "calving"];
const AI_RESULTS = ["Pending", "Negative", "Conceived"];
const COLOSTRUM_DAYS = 5;

const emptyAnimal = {
  tagNo: "",
  breed: "Nili-Ravi buffalo",
  dob: "",
  category: "Female",
  identificationMark: "",
  status: "Active (present in herd)",
  exitDate: "",
  exitReason: "",
  isBreedingBull: "No",
  breedingSet: "",
};

const emptyPedigree = {
  sire: "",
  dam: "",
  sireSire: "",
  sireDam: "",
  damSire: "",
  damDam: "",
  sireSireSire: "",
  sireSireDam: "",
  sireDamSire: "",
  sireDamDam: "",
  damSireSire: "",
  damSireDam: "",
  damDamSire: "",
  damDamDam: "",
};

function makeReproParity(parityNo) {
  return {
    parityNo: String(parityNo),
    conceptionDate: "",
    expectedCalvingDate: "",
    remarks: "",
    aiRecords: [],
  };
}

function makeCalvingParity(parityNo) {
  return {
    parityNo: String(parityNo),
    calvingDate: "",
    calfSex: "",
    calfTag: "",
    calfSire: "",
    calvingOutcome: "Normal calving",
    remarks: "",
  };
}

function parseDisplayDate(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.trim().split("/");
  if (parts.length !== 3) return null;
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!day || !month || !year) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return dt;
}

function formatDateDisplay(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeDisplayDate(value) {
  const dt = parseDisplayDate(value);
  return dt ? formatDateDisplay(dt) : value;
}

function addDays(dateStr, days) {
  const dt = parseDisplayDate(dateStr);
  if (!dt) return "";
  const copy = new Date(dt);
  copy.setDate(copy.getDate() + days);
  return formatDateDisplay(copy);
}

function normalizeRomanInput(value) {
  return (value || "").toUpperCase().replace(/[^IVXLCDM]/g, "");
}

function isArchivedAnimal(animal) {
  const archivedStatus = animal?.status === "Dead" || animal?.status === "Culled";
  return archivedStatus && Boolean((animal?.exitDate || "").trim()) && Boolean((animal?.exitReason || "").trim());
}

function normalizeAnimalFormData(form) {
  const next = { ...form };
  if (next.status === "Active (present in herd)") {
    next.exitDate = "";
    next.exitReason = "";
  }
  if (next.category !== "Male") {
    next.isBreedingBull = "No";
    next.breedingSet = "";
  } else {
    next.isBreedingBull = next.isBreedingBull || "No";
    next.breedingSet = next.isBreedingBull === "Yes" ? normalizeRomanInput(next.breedingSet || "") : "";
  }
  return next;
}

function getFemaleLifecycle(animal) {
  if (!animal || animal.category !== "Female") return animal?.category || "";
  if (!animal.firstCalvingDate) return "Heifer";
  const calving = parseDisplayDate(animal.firstCalvingDate);
  if (!calving) return "Heifer";
  const today = new Date();
  const days = Math.max(0, Math.round((today.getTime() - calving.getTime()) / 86400000));
  if (days < COLOSTRUM_DAYS) return animal.preCalvingLifecycle === "Heifer" ? "Colostrum-Heifer" : "Colostrum";
  return animal.preCalvingLifecycle === "Heifer" ? "Dry" : "Milk";
}

function sortByTag(a, b) {
  const an = Number(a.tagNo);
  const bn = Number(b.tagNo);
  const aNum = Number.isFinite(an) && !Number.isNaN(an);
  const bNum = Number.isFinite(bn) && !Number.isNaN(bn);
  if (aNum && bNum) return an - bn;
  return String(a.tagNo).localeCompare(String(b.tagNo), undefined, { numeric: true, sensitivity: "base" });
}

function withDefaults(animal) {
  return {
    ...animal,
    femaleDetails: {
      pedigree: { ...emptyPedigree, ...(animal.femaleDetails?.pedigree || {}) },
      reproductionParities: animal.femaleDetails?.reproductionParities?.length
        ? animal.femaleDetails.reproductionParities.map((p) => ({
            ...p,
            aiRecords: (p.aiRecords || []).map((r) => ({ ...r })),
          }))
        : [makeReproParity(0)],
      selectedReproParity: animal.femaleDetails?.selectedReproParity || "0",
      calvingParities: animal.femaleDetails?.calvingParities?.length
        ? animal.femaleDetails.calvingParities.map((p) => ({ ...p }))
        : [makeCalvingParity(1)],
    },
  };
}

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-md">
      <div className="mb-3 text-lg font-semibold text-emerald-900">{title}</div>
      {children}
    </div>
  );
}

function Grid({ children }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{children}</div>;
}

function TextField({ label, value, onChange, readOnly = false, placeholder = "" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} readOnly={readOnly} placeholder={placeholder} onChange={readOnly ? undefined : (e) => onChange(e.target.value)} />
    </label>
  );
}

function SelectField({ label, value, onChange, options, disabled = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {options.map((o) => (
          <option key={o} value={o}>{o || "—"}</option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({ label, value, onChange, rows = 3 }) {
  return (
    <label className="field textarea-field">
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function StatCard({ title, value }) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-md">
      <div className="text-sm text-emerald-700">{title}</div>
      <div className="text-2xl font-semibold text-emerald-900">{value}</div>
    </div>
  );
}

export default function AnimalDataRecordingApp() {
  const [animals, setAnimals] = useState([]);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [herdView, setHerdView] = useState("current");
  const [detailTab, setDetailTab] = useState("pedigree");
  const [newAnimal, setNewAnimal] = useState({ ...emptyAnimal });

  const normalizedAnimals = useMemo(() => animals.map(withDefaults), [animals]);
  const activeAnimals = useMemo(() => normalizedAnimals.filter((a) => !isArchivedAnimal(a)), [normalizedAnimals]);
  const archivedAnimals = useMemo(() => normalizedAnimals.filter((a) => isArchivedAnimal(a)), [normalizedAnimals]);

  const filteredCurrentAnimals = useMemo(() => {
    const q = search.toLowerCase();
    return activeAnimals.filter((a) =>
      [a.tagNo, a.breed, a.category, a.status, a.identificationMark, a.isBreedingBull, a.breedingSet].join(" ").toLowerCase().includes(q)
    );
  }, [activeAnimals, search]);

  const filteredArchivedAnimals = useMemo(() => {
    const q = search.toLowerCase();
    return archivedAnimals.filter((a) =>
      [a.tagNo, a.breed, a.category, a.status, a.exitDate, a.exitReason].join(" ").toLowerCase().includes(q)
    );
  }, [archivedAnimals, search]);

  const stats = useMemo(() => {
    const females = activeAnimals.filter((a) => a.category === "Female");
    const males = activeAnimals.filter((a) => a.category === "Male");
    return {
      totalAnimals: activeAnimals.length,
      femaleCount: females.length,
      maleCount: males.length,
      heiferCount: females.filter((a) => getFemaleLifecycle(a) === "Heifer").length,
      colostrumHeiferCount: females.filter((a) => getFemaleLifecycle(a) === "Colostrum-Heifer").length,
      colostrumCount: females.filter((a) => getFemaleLifecycle(a) === "Colostrum").length,
      milkCount: females.filter((a) => getFemaleLifecycle(a) === "Milk").length,
      dryCount: females.filter((a) => getFemaleLifecycle(a) === "Dry").length,
    };
  }, [activeAnimals]);

  const selectedAnimal = normalizedAnimals.find((a) => a.id === selectedId) || null;
  const selectedReproParity =
    selectedAnimal?.femaleDetails?.reproductionParities?.find((p) => p.parityNo === selectedAnimal?.femaleDetails?.selectedReproParity) || null;

  function handleFormStatusChange(status) {
    setNewAnimal((s) => normalizeAnimalFormData({ ...s, status }));
  }

  function handleFormCategoryChange(category) {
    setNewAnimal((s) => normalizeAnimalFormData({ ...s, category }));
  }

  function addAnimal() {
    if (!newAnimal.tagNo.trim()) {
      alert("Please enter Tag No.");
      return;
    }
    const prepared = normalizeAnimalFormData(newAnimal);
    const item = withDefaults({
      id: Date.now(),
      ...prepared,
      preCalvingLifecycle: prepared.category === "Female" ? "Heifer" : "",
      firstCalvingDate: "",
    });
    setAnimals((prev) => [item, ...prev].sort(sortByTag));
    setSelectedId(item.id);
    setNewAnimal({ ...emptyAnimal });
    setShowAdd(false);
  }

  function patchSelected(fn) {
    setAnimals((prev) => prev.map((a) => (a.id === selectedId ? fn(withDefaults(a)) : a)));
  }

  function updateFemalePedigree(key, value) {
    patchSelected((a) => ({
      ...a,
      femaleDetails: {
        ...a.femaleDetails,
        pedigree: { ...a.femaleDetails.pedigree, [key]: value },
      },
    }));
  }

  function updateSelectedRepro(key, value) {
    patchSelected((a) => {
      const currentParity = a.femaleDetails.selectedReproParity;
      const parities = a.femaleDetails.reproductionParities.map((p) =>
        p.parityNo === currentParity
          ? { ...p, [key]: value, expectedCalvingDate: key === "conceptionDate" ? addDays(value, 310) : p.expectedCalvingDate }
          : p
      );
      return { ...a, femaleDetails: { ...a.femaleDetails, reproductionParities: parities } };
    });
  }

  function addAIRecord() {
    patchSelected((a) => {
      const currentParity = a.femaleDetails.selectedReproParity;
      const parities = a.femaleDetails.reproductionParities.map((p) =>
        p.parityNo === currentParity
          ? { ...p, aiRecords: [...p.aiRecords, { aiDate: "", aiBullNo: "", aiSetNo: "", result: "Pending" }] }
          : p
      );
      return { ...a, femaleDetails: { ...a.femaleDetails, reproductionParities: parities } };
    });
  }

  function removeAIRecord() {
    patchSelected((a) => {
      const currentParity = a.femaleDetails.selectedReproParity;
      const parities = a.femaleDetails.reproductionParities.map((p) =>
        p.parityNo === currentParity ? { ...p, aiRecords: p.aiRecords.slice(0, -1) } : p
      );
      return { ...a, femaleDetails: { ...a.femaleDetails, reproductionParities: parities } };
    });
  }

  function updateAIRecord(idx, key, value) {
    patchSelected((a) => {
      const currentParity = a.femaleDetails.selectedReproParity;
      const parities = a.femaleDetails.reproductionParities.map((p) => {
        if (p.parityNo !== currentParity) return p;
        const nextRecords = p.aiRecords.map((r, i) => (i === idx ? { ...r, [key]: value } : r));
        return { ...p, aiRecords: nextRecords };
      });
      return { ...a, femaleDetails: { ...a.femaleDetails, reproductionParities: parities } };
    });
  }

  function incrementReproParity() {
    patchSelected((a) => {
      const current = Number(a.femaleDetails.selectedReproParity || 0) + 1;
      const next = String(current);
      const exists = a.femaleDetails.reproductionParities.some((p) => p.parityNo === next);
      return {
        ...a,
        femaleDetails: {
          ...a.femaleDetails,
          selectedReproParity: next,
          reproductionParities: exists ? a.femaleDetails.reproductionParities : [...a.femaleDetails.reproductionParities, makeReproParity(next)],
        },
      };
    });
  }

  function decrementReproParity() {
    patchSelected((a) => ({
      ...a,
      femaleDetails: {
        ...a.femaleDetails,
        selectedReproParity: String(Math.max(0, Number(a.femaleDetails.selectedReproParity || 0) - 1)),
      },
    }));
  }

  function updateCalvingParity(idx, key, value) {
    patchSelected((a) => {
      const next = a.femaleDetails.calvingParities.map((p, i) => (i === idx ? { ...p, [key]: value } : p));
      return { ...a, femaleDetails: { ...a.femaleDetails, calvingParities: next } };
    });
  }

  function addCalvingParity() {
    patchSelected((a) => ({
      ...a,
      femaleDetails: {
        ...a.femaleDetails,
        calvingParities: [...a.femaleDetails.calvingParities, makeCalvingParity(a.femaleDetails.calvingParities.length + 1)],
      },
    }));
  }

  function removeCalvingParity() {
    patchSelected((a) => ({
      ...a,
      femaleDetails: {
        ...a.femaleDetails,
        calvingParities: a.femaleDetails.calvingParities.length > 1 ? a.femaleDetails.calvingParities.slice(0, -1) : a.femaleDetails.calvingParities,
      },
    }));
  }

  const currentList = herdView === "current" ? filteredCurrentAnimals : filteredArchivedAnimals;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-xl">
          <div className="topbar">
            <div>
              <div className="title">Buffalo Animal Data Recording App</div>
              <div className="subtitle">Phase 2.1 patch · female tabs added: Pedigree, Reproduction, Calving</div>
            </div>
            <button className="primary-btn" onClick={() => setShowAdd(true)}>Add Animal</button>
          </div>
        </div>

        {showAdd && (
          <Section title="Add Animal">
            <Grid>
              <SelectField label="Breed" value={newAnimal.breed} onChange={(v) => setNewAnimal((s) => ({ ...s, breed: v }))} options={BREEDS} />
              <TextField label="Tag No." value={newAnimal.tagNo} onChange={(v) => setNewAnimal((s) => ({ ...s, tagNo: v }))} />
              <TextField label="Date of birth" value={newAnimal.dob} onChange={(v) => setNewAnimal((s) => ({ ...s, dob: normalizeDisplayDate(v) }))} placeholder="dd/mm/yyyy" />
              <SelectField label="Category" value={newAnimal.category} onChange={handleFormCategoryChange} options={SEX_OPTIONS} />
              <TextField label="Identification mark" value={newAnimal.identificationMark} onChange={(v) => setNewAnimal((s) => ({ ...s, identificationMark: v }))} />
              <SelectField label="Status" value={newAnimal.status} onChange={handleFormStatusChange} options={STATUS_OPTIONS} />
              {newAnimal.category === "Male" && (
                <>
                  <SelectField label="Selected for breeding" value={newAnimal.isBreedingBull || "No"} onChange={(v) => setNewAnimal((s) => normalizeAnimalFormData({ ...s, isBreedingBull: v }))} options={["No", "Yes"]} />
                  {newAnimal.isBreedingBull === "Yes" && (
                    <TextField label="Included as breeding in which set (Roman numerals only)" value={newAnimal.breedingSet || ""} onChange={(v) => setNewAnimal((s) => ({ ...s, breedingSet: normalizeRomanInput(v) }))} />
                  )}
                </>
              )}
              {newAnimal.status !== "Active (present in herd)" && (
                <>
                  <TextField label="Date of Death / Culling" value={newAnimal.exitDate || ""} onChange={(v) => setNewAnimal((s) => ({ ...s, exitDate: normalizeDisplayDate(v) }))} placeholder="dd/mm/yyyy" />
                  <TextAreaField label="Reason of Death / Culling" value={newAnimal.exitReason || ""} onChange={(v) => setNewAnimal((s) => ({ ...s, exitReason: v }))} />
                </>
              )}
            </Grid>
            <div className="action-row">
              <button className="primary-btn" onClick={addAnimal}>Save Animal</button>
              <button className="secondary-btn" onClick={() => { setShowAdd(false); setNewAnimal({ ...emptyAnimal }); }}>Cancel</button>
            </div>
          </Section>
        )}

        <div className="stats-grid">
          <StatCard title="Total Animals" value={stats.totalAnimals} />
          <StatCard title="Females" value={stats.femaleCount} />
          <StatCard title="Males" value={stats.maleCount} />
          <StatCard title="Heifers" value={stats.heiferCount} />
          <StatCard title="Colostrum-Heifer" value={stats.colostrumHeiferCount} />
          <StatCard title="Colostrum" value={stats.colostrumCount} />
          <StatCard title="In Milk" value={stats.milkCount} />
          <StatCard title="Dry" value={stats.dryCount} />
        </div>

        <div className="main-grid">
          <Section title="Herd Registry">
            <TextField label="Search" value={search} onChange={setSearch} />
            <div className="action-row">
              <button className={herdView === "current" ? "primary-btn" : "secondary-btn"} onClick={() => setHerdView("current")}>Current Herd</button>
              <button className={herdView === "archive" ? "primary-btn" : "secondary-btn"} onClick={() => setHerdView("archive")}>Archive</button>
            </div>
            <div className="list-wrap">
              {currentList.length === 0 && <div className="empty-note">No animals found.</div>}
              {currentList.map((animal) => (
                <button key={animal.id} className={`animal-card ${selectedId === animal.id ? "selected" : ""}`} onClick={() => { setSelectedId(animal.id); setDetailTab("pedigree"); }}>
                  <div className="animal-title">{animal.tagNo}</div>
                  <div className="animal-sub">
                    {animal.breed} · {animal.category === "Female" ? getFemaleLifecycle(animal) : animal.isBreedingBull === "Yes" ? `Breeding Bull (${animal.breedingSet || "Set blank"})` : "Male"}
                  </div>
                </button>
              ))}
            </div>
          </Section>

          <div className="right-stack">
            <Section title="Selected Animal Preview">
              {!selectedAnimal && <div className="empty-note">No animal selected.</div>}
              {selectedAnimal && (
                <div className="preview-grid">
                  <div><strong>Tag No.:</strong> {selectedAnimal.tagNo}</div>
                  <div><strong>Breed:</strong> {selectedAnimal.breed}</div>
                  <div><strong>DOB:</strong> {selectedAnimal.dob || "—"}</div>
                  <div><strong>Sex:</strong> {selectedAnimal.category}</div>
                  <div><strong>Status:</strong> {selectedAnimal.status}</div>
                  <div><strong>Identification Mark:</strong> {selectedAnimal.identificationMark || "—"}</div>
                  {selectedAnimal.category === "Female" && <div><strong>Current category:</strong> {getFemaleLifecycle(selectedAnimal)}</div>}
                  {selectedAnimal.category === "Male" && <div><strong>Breeding bull:</strong> {selectedAnimal.isBreedingBull === "Yes" ? `Yes (${selectedAnimal.breedingSet || "Set blank"})` : "No"}</div>}
                </div>
              )}
            </Section>

            {selectedAnimal?.category === "Female" && (
              <Section title="Female Tabs">
                <div className="tab-row">
                  {FEMALE_TABS.map((tab) => (
                    <button key={tab} className={detailTab === tab ? "primary-btn tab-btn" : "secondary-btn tab-btn"} onClick={() => setDetailTab(tab)}>
                      {tab}
                    </button>
                  ))}
                </div>

                {detailTab === "pedigree" && (
                  <Grid>
                    <TextField label="Sire" value={selectedAnimal.femaleDetails.pedigree.sire} onChange={(v) => updateFemalePedigree("sire", v)} />
                    <TextField label="Dam" value={selectedAnimal.femaleDetails.pedigree.dam} onChange={(v) => updateFemalePedigree("dam", v)} />
                    <TextField label="Sire's sire" value={selectedAnimal.femaleDetails.pedigree.sireSire} onChange={(v) => updateFemalePedigree("sireSire", v)} />
                    <TextField label="Sire's dam" value={selectedAnimal.femaleDetails.pedigree.sireDam} onChange={(v) => updateFemalePedigree("sireDam", v)} />
                    <TextField label="Dam's sire" value={selectedAnimal.femaleDetails.pedigree.damSire} onChange={(v) => updateFemalePedigree("damSire", v)} />
                    <TextField label="Dam's dam" value={selectedAnimal.femaleDetails.pedigree.damDam} onChange={(v) => updateFemalePedigree("damDam", v)} />
                    <TextField label="Great-grandsire (SSS)" value={selectedAnimal.femaleDetails.pedigree.sireSireSire} onChange={(v) => updateFemalePedigree("sireSireSire", v)} />
                    <TextField label="Great-granddam (SSD)" value={selectedAnimal.femaleDetails.pedigree.sireSireDam} onChange={(v) => updateFemalePedigree("sireSireDam", v)} />
                    <TextField label="Great-grandsire (SDS)" value={selectedAnimal.femaleDetails.pedigree.sireDamSire} onChange={(v) => updateFemalePedigree("sireDamSire", v)} />
                    <TextField label="Great-granddam (SDD)" value={selectedAnimal.femaleDetails.pedigree.sireDamDam} onChange={(v) => updateFemalePedigree("sireDamDam", v)} />
                    <TextField label="Great-grandsire (DSS)" value={selectedAnimal.femaleDetails.pedigree.damSireSire} onChange={(v) => updateFemalePedigree("damSireSire", v)} />
                    <TextField label="Great-granddam (DSD)" value={selectedAnimal.femaleDetails.pedigree.damSireDam} onChange={(v) => updateFemalePedigree("damSireDam", v)} />
                    <TextField label="Great-grandsire (DDS)" value={selectedAnimal.femaleDetails.pedigree.damDamSire} onChange={(v) => updateFemalePedigree("damDamSire", v)} />
                    <TextField label="Great-granddam (DDD)" value={selectedAnimal.femaleDetails.pedigree.damDamDam} onChange={(v) => updateFemalePedigree("damDamDam", v)} />
                  </Grid>
                )}

                {detailTab === "reproduction" && selectedReproParity && (
                  <div className="stack-gap">
                    <div className="parity-head">
                      <div className="parity-controls">
                        <button className="secondary-btn square-btn" onClick={decrementReproParity}>−</button>
                        <div className="parity-box">{selectedAnimal.femaleDetails.selectedReproParity}</div>
                        <button className="secondary-btn square-btn" onClick={incrementReproParity}>+</button>
                      </div>
                    </div>
                    <Grid>
                      <TextField label="Conception date" value={selectedReproParity.conceptionDate || ""} onChange={(v) => updateSelectedRepro("conceptionDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" />
                      <TextField label="Expected calving date" value={selectedReproParity.expectedCalvingDate || ""} onChange={() => {}} readOnly />
                      <TextAreaField label="Remarks" value={selectedReproParity.remarks || ""} onChange={(v) => updateSelectedRepro("remarks", v)} />
                    </Grid>

                    <div className="subsection-label">AI records</div>
                    {(selectedReproParity.aiRecords || []).length === 0 && <div className="empty-note">No AI records yet.</div>}
                    {(selectedReproParity.aiRecords || []).map((rec, idx) => (
                      <div key={`ai-${idx}`} className="mini-card">
                        <Grid>
                          <TextField label={`AI ${idx + 1} date`} value={rec.aiDate || ""} onChange={(v) => updateAIRecord(idx, "aiDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" />
                          <TextField label="Bull No." value={rec.aiBullNo || ""} onChange={(v) => updateAIRecord(idx, "aiBullNo", v)} />
                          <TextField label="Set No." value={rec.aiSetNo || ""} onChange={(v) => updateAIRecord(idx, "aiSetNo", v)} />
                          <SelectField label="Result" value={rec.result || "Pending"} onChange={(v) => updateAIRecord(idx, "result", v)} options={AI_RESULTS} />
                        </Grid>
                      </div>
                    ))}
                    <div className="action-row">
                      <button className="primary-btn" onClick={addAIRecord}>Add AI record</button>
                      <button className="secondary-btn" onClick={removeAIRecord}>Remove last AI</button>
                    </div>
                  </div>
                )}

                {detailTab === "calving" && (
                  <div className="stack-gap">
                    {selectedAnimal.femaleDetails.calvingParities.map((cp, idx) => (
                      <div key={`calving-${idx}`} className="mini-card">
                        <div className="subsection-label">Calving parity {cp.parityNo}</div>
                        <Grid>
                          <TextField label="Calving date" value={cp.calvingDate || ""} onChange={(v) => updateCalvingParity(idx, "calvingDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" />
                          <SelectField label="Calf sex" value={cp.calfSex || ""} onChange={(v) => updateCalvingParity(idx, "calfSex", v)} options={["", ...SEX_OPTIONS]} />
                          <TextField label="Calf tag no." value={cp.calfTag || ""} onChange={(v) => updateCalvingParity(idx, "calfTag", v)} />
                          <TextField label="Calf sire" value={cp.calfSire || ""} onChange={(v) => updateCalvingParity(idx, "calfSire", v)} />
                          <SelectField label="Calving outcome" value={cp.calvingOutcome || "Normal calving"} onChange={(v) => updateCalvingParity(idx, "calvingOutcome", v)} options={["Normal calving", "Stillbirth", "Abortion"]} />
                          <TextAreaField label="Remarks" value={cp.remarks || ""} onChange={(v) => updateCalvingParity(idx, "remarks", v)} />
                        </Grid>
                      </div>
                    ))}
                    <div className="action-row">
                      <button className="primary-btn" onClick={addCalvingParity}>Add calving parity</button>
                      <button className="secondary-btn" onClick={removeCalvingParity}>Remove last parity</button>
                    </div>
                  </div>
                )}
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
