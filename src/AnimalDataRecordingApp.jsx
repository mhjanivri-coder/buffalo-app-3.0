import React, { useMemo, useState } from "react";

const BREEDS = ["Murrah buffalo", "Nili-Ravi buffalo"];
const SEX_OPTIONS = ["Female", "Male"];
const STATUS_OPTIONS = ["Active (present in herd)", "Dead", "Culled"];
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

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o || "—"}</option>
        ))}
      </select>
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
  const [newAnimal, setNewAnimal] = useState({ ...emptyAnimal });

  const activeAnimals = useMemo(() => animals.filter((a) => !isArchivedAnimal(a)), [animals]);
  const archivedAnimals = useMemo(() => animals.filter((a) => isArchivedAnimal(a)), [animals]);

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

  const selectedAnimal = animals.find((a) => a.id === selectedId) || null;

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
    const item = {
      id: Date.now(),
      ...prepared,
      preCalvingLifecycle: prepared.category === "Female" ? "Heifer" : "",
      firstCalvingDate: "",
    };
    setAnimals((prev) => [item, ...prev].sort(sortByTag));
    setSelectedId(item.id);
    setNewAnimal({ ...emptyAnimal });
    setShowAdd(false);
  }

  function currentList() {
    return herdView === "current" ? filteredCurrentAnimals : filteredArchivedAnimals;
  }

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-xl">
          <div className="topbar">
            <div>
              <div className="title">Buffalo Animal Data Recording App</div>
              <div className="subtitle">Murrah Farm and Nili-Ravi Farm · patched Add Animal form · deploy-ready Vite project</div>
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
                  <label className="field textarea-field">
                    <span>Reason of Death / Culling</span>
                    <textarea rows="3" value={newAnimal.exitReason || ""} onChange={(e) => setNewAnimal((s) => ({ ...s, exitReason: e.target.value }))} />
                  </label>
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
              {currentList().length === 0 && <div className="empty-note">No animals found.</div>}
              {currentList().map((animal) => (
                <button key={animal.id} className={`animal-card ${selectedId === animal.id ? "selected" : ""}`} onClick={() => setSelectedId(animal.id)}>
                  <div className="animal-title">{animal.tagNo}</div>
                  <div className="animal-sub">
                    {animal.breed} · {animal.category === "Female" ? getFemaleLifecycle(animal) : animal.isBreedingBull === "Yes" ? `Breeding Bull (${animal.breedingSet || "Set blank"})` : "Male"}
                  </div>
                </button>
              ))}
            </div>
          </Section>

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
                {selectedAnimal.status !== "Active (present in herd)" && (
                  <>
                    <div><strong>Exit date:</strong> {selectedAnimal.exitDate || "—"}</div>
                    <div><strong>Exit reason:</strong> {selectedAnimal.exitReason || "—"}</div>
                  </>
                )}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
