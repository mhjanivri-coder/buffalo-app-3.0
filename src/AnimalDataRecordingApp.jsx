import React, { useMemo, useState } from "react";

const BREEDS = ["Murrah buffalo", "Nili-Ravi buffalo"];
const SEX_OPTIONS = ["Female", "Male"];
const STATUS_OPTIONS = ["Active (present in herd)", "Dead", "Culled"];
const FEMALE_TABS = ["pedigree", "reproduction", "calving", "production"];
const AI_RESULTS = ["Pending", "Negative", "Conceived"];
const CALVING_OUTCOMES = ["Normal calving", "Stillbirth", "Abortion"];
const ENTRY_MODES = ["Manual", "Friday Records"];
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

function makeFridayRecord(date = "") {
  return {
    date,
    morningMilk: "",
    eveningMilk: "",
    totalDailyYield: "",
    fatPct: "",
    snfPct: "",
    tsPct: "",
  };
}

function makeProductionLactation(parityNo) {
  return {
    parityNo: String(parityNo),
    entryMode: "Manual",
    calvingDate: "",
    dryDate: "",
    manualSummary: {
      totalLactationMilk: "",
      standardLactationMilk: "",
      peakYield: "",
    },
    fridayRecords: [],
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

function daysBetween(start, end) {
  const a = parseDisplayDate(start);
  const b = parseDisplayDate(end);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
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
  const calvings = animal?.femaleDetails?.calvingParities || [];
  const last = [...calvings]
    .filter((p) => p.calvingDate && p.calvingOutcome === "Normal calving")
    .sort((a, b) => {
      const ad = parseDisplayDate(a.calvingDate);
      const bd = parseDisplayDate(b.calvingDate);
      if (!ad || !bd) return 0;
      return bd.getTime() - ad.getTime();
    })[0];
  if (!last?.calvingDate) return "Heifer";
  const calving = parseDisplayDate(last.calvingDate);
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
    femaleDetails: animal.category === "Female" ? {
      pedigree: { ...emptyPedigree, ...(animal.femaleDetails?.pedigree || {}) },
      reproductionParities: animal.femaleDetails?.reproductionParities?.length
        ? animal.femaleDetails.reproductionParities.map((p) => ({ ...p, aiRecords: (p.aiRecords || []).map((r) => ({ ...r })) }))
        : [makeReproParity(0)],
      selectedReproParity: animal.femaleDetails?.selectedReproParity || "0",
      calvingParities: animal.femaleDetails?.calvingParities?.length
        ? animal.femaleDetails.calvingParities.map((p) => ({ ...p }))
        : [makeCalvingParity(1)],
      productionLactations: animal.femaleDetails?.productionLactations?.length
        ? animal.femaleDetails.productionLactations.map((l) => ({
            ...l,
            manualSummary: { totalLactationMilk: "", standardLactationMilk: "", peakYield: "", ...(l.manualSummary || {}) },
            fridayRecords: (l.fridayRecords || []).map((r) => ({ ...r })),
          }))
        : [makeProductionLactation(1)],
      selectedProductionParity: animal.femaleDetails?.selectedProductionParity || "1",
    } : undefined,
    maleDetails: animal.category === "Male" ? {
      pedigree: { ...emptyPedigree, ...(animal.maleDetails?.pedigree || {}) },
    } : undefined,
  };
}

function formatBullSet(aiRecord) {
  if (!aiRecord) return "";
  const bullNo = (aiRecord.aiBullNo || "").trim();
  const setNo = (aiRecord.aiSetNo || "").trim();
  if (bullNo && setNo) return `${bullNo}/${setNo}`;
  return bullNo || setNo || "";
}

function getReproParityByNo(animal, parityNo) {
  return animal?.femaleDetails?.reproductionParities?.find((p) => Number(p.parityNo) === Number(parityNo)) || null;
}

function getConceivedAIRecord(reproParity) {
  if (!reproParity) return null;
  const aiRecords = reproParity.aiRecords || [];
  const conceived = aiRecords.find((r) => r.result === "Conceived");
  if (conceived) return conceived;
  if (reproParity.conceptionDate) {
    const dated = aiRecords.find((r) => r.aiDate === reproParity.conceptionDate);
    if (dated) return dated;
  }
  return aiRecords.length ? aiRecords[aiRecords.length - 1] : null;
}

function getCalfSireForCalving(animal, calvingParityNo) {
  const sourceReproParity = Number(calvingParityNo) - 1;
  if (sourceReproParity < 0) return "";
  const reproParity = getReproParityByNo(animal, sourceReproParity);
  return formatBullSet(getConceivedAIRecord(reproParity));
}

function buildAutoCalfAnimal(dam, calvingParity) {
  if (!dam || dam.category !== "Female") return null;
  if ((calvingParity?.calvingOutcome || "") !== "Normal calving") return null;
  const calfTag = (calvingParity?.calfTag || "").trim();
  const calfSex = calvingParity?.calfSex || "";
  const calfDob = calvingParity?.calvingDate || "";
  const calfSire = (calvingParity?.calfSire || getCalfSireForCalving(dam, calvingParity?.parityNo) || "").trim();
  if (!calfTag || !calfSex || !calfDob) return null;

  const base = {
    id: `calf-${dam.id}-${calvingParity.parityNo}`,
    tagNo: calfTag,
    breed: dam.breed || "Nili-Ravi buffalo",
    dob: calfDob,
    category: calfSex === "Female" ? "Female" : "Male",
    identificationMark: "",
    status: "Active (present in herd)",
    exitDate: "",
    exitReason: "",
    isBreedingBull: "No",
    breedingSet: "",
    linkedDamId: dam.id,
    linkedCalvingParityNo: String(calvingParity.parityNo),
    autoAddedFromBirth: true,
    preCalvingLifecycle: "Heifer",
  };

  if (calfSex === "Female") {
    return withDefaults({
      ...base,
      femaleDetails: {
        pedigree: { ...emptyPedigree, dam: dam.tagNo || "", sire: calfSire },
        reproductionParities: [makeReproParity(0)],
        selectedReproParity: "0",
        calvingParities: [makeCalvingParity(1)],
        productionLactations: [makeProductionLactation(1)],
        selectedProductionParity: "1",
      },
    });
  }

  return withDefaults({
    ...base,
    maleDetails: {
      pedigree: { ...emptyPedigree, dam: dam.tagNo || "", sire: calfSire },
    },
  });
}

function syncDamCalvesInHerd(animals, dam) {
  if (!dam || dam.category !== "Female") return animals;
  const calfRecords = (dam.femaleDetails?.calvingParities || [])
    .map((cp) => buildAutoCalfAnimal(dam, cp))
    .filter(Boolean);

  let nextAnimals = animals.filter((animal) => {
    if (!animal?.autoAddedFromBirth || animal?.linkedDamId !== dam.id) return true;
    return calfRecords.some((calf) => calf.id === animal.id);
  });

  calfRecords.forEach((calf) => {
    const idx = nextAnimals.findIndex((animal) => animal.id === calf.id || (animal.tagNo === calf.tagNo && animal.id !== dam.id));
    if (idx >= 0) {
      nextAnimals[idx] = withDefaults({
        ...nextAnimals[idx],
        ...calf,
        femaleDetails: calf.category === "Female" ? calf.femaleDetails : nextAnimals[idx].femaleDetails,
        maleDetails: calf.category === "Male" ? calf.maleDetails : nextAnimals[idx].maleDetails,
      });
    } else {
      nextAnimals = [calf, ...nextAnimals];
    }
  });

  return nextAnimals.sort(sortByTag);
}

function firstRecordableFriday(calvingDate) {
  const base = parseDisplayDate(calvingDate);
  if (!base) return "";
  for (let i = 0; i <= 14; i += 1) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const candidate = formatDateDisplay(d);
    const gap = daysBetween(calvingDate, candidate);
    if (d.getDay() === 5 && gap > 5) return candidate;
  }
  return "";
}

function getNextFridayRecordDate(lactation) {
  const existing = lactation?.fridayRecords || [];
  if (!existing.length) return firstRecordableFriday(lactation?.calvingDate || "");
  const lastDate = existing[existing.length - 1]?.date || "";
  return lastDate ? addDays(lastDate, 7) : "";
}

function recalcFridayRecord(record) {
  const hasMilkEntry = record.morningMilk !== "" || record.eveningMilk !== "";
  const total = Number(record.morningMilk || 0) + Number(record.eveningMilk || 0);
  return { ...record, totalDailyYield: hasMilkEntry ? String(total) : record.totalDailyYield || "" };
}

function computeProductionMetrics(lactation) {
  if (!lactation) return { lactationLength: 0, totalLactationMilk: 0, standardLactationMilk: 0, peakYield: 0 };
  const calvingDate = lactation.calvingDate || "";
  const dryDate = lactation.dryDate || "";
  const lactationLength = calvingDate && dryDate ? daysBetween(calvingDate, dryDate) + 1 : 0;

  if (lactation.entryMode === "Manual") {
    return {
      lactationLength,
      totalLactationMilk: Number(lactation.manualSummary.totalLactationMilk || 0),
      standardLactationMilk: Number(lactation.manualSummary.standardLactationMilk || 0),
      peakYield: Number(lactation.manualSummary.peakYield || 0),
    };
  }

  const records = [...(lactation.fridayRecords || [])].filter((r) => r.date);
  let total = 0;
  let standard = 0;
  let peak = 0;
  let standardUsed = 0;
  records.forEach((r, index) => {
    const milk = Number(r.totalDailyYield || 0);
    peak = Math.max(peak, milk);
    const daysBlock = index === 0 && calvingDate && r.date === firstRecordableFriday(calvingDate) ? daysBetween(calvingDate, r.date) + 7 : 7;
    total += milk * daysBlock;
    const stdDays = Math.max(0, Math.min(daysBlock, 305 - standardUsed));
    standardUsed += stdDays;
    standard += milk * stdDays;
  });
  return { lactationLength, totalLactationMilk: total, standardLactationMilk: standard, peakYield: peak };
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
  const selectedLactation =
    selectedAnimal?.femaleDetails?.productionLactations?.find((l) => l.parityNo === selectedAnimal?.femaleDetails?.selectedProductionParity) || null;
  const productionMetrics = computeProductionMetrics(selectedLactation);

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
    });
    setAnimals((prev) => [item, ...prev].sort(sortByTag));
    setSelectedId(item.id);
    setNewAnimal({ ...emptyAnimal });
    setShowAdd(false);
  }

  function patchSelected(fn) {
    setAnimals((prev) => {
      let updatedSelected = null;
      const mapped = prev.map((a) => {
        if (a.id !== selectedId) return a;
        updatedSelected = fn(withDefaults(a));
        return updatedSelected;
      });
      return updatedSelected?.category === "Female" ? syncDamCalvesInHerd(mapped, updatedSelected) : mapped;
    });
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
        const nextRecords = p.aiRecords.map((r, i) => {
          const next = i === idx ? { ...r, [key]: value } : r;
          return next;
        });
        const conceivedRecord = nextRecords.find((r) => r.result === "Conceived");
        return {
          ...p,
          aiRecords: nextRecords,
          conceptionDate: conceivedRecord ? conceivedRecord.aiDate || p.conceptionDate : p.conceptionDate,
          expectedCalvingDate: conceivedRecord ? addDays(conceivedRecord.aiDate || "", 310) : p.expectedCalvingDate,
        };
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
      const next = a.femaleDetails.calvingParities.map((p, i) => {
        if (i !== idx) return p;
        const row = { ...p, [key]: value };
        if (key === "calvingDate" || key === "calvingOutcome") {
          row.calfSire = row.calvingOutcome === "Normal calving" ? (getCalfSireForCalving(a, row.parityNo) || row.calfSire || "") : "";
        }
        if (key === "calvingOutcome" && value !== "Normal calving") {
          row.calfSex = "";
          row.calfTag = "";
          row.calfSire = "";
        }
        return row;
      });
      return {
        ...a,
        preCalvingLifecycle: getFemaleLifecycle(a),
        femaleDetails: { ...a.femaleDetails, calvingParities: next },
      };
    });
  }

  function addCalvingParity() {
    patchSelected((a) => {
      const nextNo = String(a.femaleDetails.calvingParities.length + 1);
      const prodExists = a.femaleDetails.productionLactations.some((l) => l.parityNo === nextNo);
      return {
        ...a,
        femaleDetails: {
          ...a.femaleDetails,
          calvingParities: [...a.femaleDetails.calvingParities, makeCalvingParity(nextNo)],
          productionLactations: prodExists ? a.femaleDetails.productionLactations : [...a.femaleDetails.productionLactations, makeProductionLactation(nextNo)],
        },
      };
    });
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

  function selectProductionParity(value) {
    patchSelected((a) => ({
      ...a,
      femaleDetails: { ...a.femaleDetails, selectedProductionParity: String(value) },
    }));
  }

  function updateSelectedLactation(key, value) {
    patchSelected((a) => {
      const currentParity = a.femaleDetails.selectedProductionParity;
      const lactations = a.femaleDetails.productionLactations.map((l) =>
        l.parityNo === currentParity ? { ...l, [key]: value } : l
      );
      return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } };
    });
  }

  function updateManualSummary(key, value) {
    patchSelected((a) => {
      const currentParity = a.femaleDetails.selectedProductionParity;
      const lactations = a.femaleDetails.productionLactations.map((l) =>
        l.parityNo === currentParity ? { ...l, manualSummary: { ...l.manualSummary, [key]: value } } : l
      );
      return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } };
    });
  }

  function addFridayRecord() {
    patchSelected((a) => {
      const currentParity = a.femaleDetails.selectedProductionParity;
      const lactations = a.femaleDetails.productionLactations.map((l) =>
        l.parityNo === currentParity
          ? { ...l, fridayRecords: [...l.fridayRecords, makeFridayRecord(getNextFridayRecordDate(l))] }
          : l
      );
      return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } };
    });
  }

  function removeFridayRecord() {
    patchSelected((a) => {
      const currentParity = a.femaleDetails.selectedProductionParity;
      const lactations = a.femaleDetails.productionLactations.map((l) =>
        l.parityNo === currentParity ? { ...l, fridayRecords: l.fridayRecords.slice(0, -1) } : l
      );
      return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } };
    });
  }

  function updateFridayRecord(idx, key, value) {
    patchSelected((a) => {
      const currentParity = a.femaleDetails.selectedProductionParity;
      const lactations = a.femaleDetails.productionLactations.map((l) => {
        if (l.parityNo !== currentParity) return l;
        const records = l.fridayRecords.map((r, i) => i === idx ? recalcFridayRecord({ ...r, [key]: value }) : r);
        return { ...l, fridayRecords: records };
      });
      return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } };
    });
  }

  const currentList = herdView === "current" ? filteredCurrentAnimals : filteredArchivedAnimals;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-xl">
          <div className="topbar">
            <div>
              <div className="title">Buffalo Animal Data Recording App</div>
              <div className="subtitle">Phase 2.3 patch · production tab, Friday records, first recordable Friday rule</div>
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
                          <TextField label="Calf tag no. (auto-adds calf)" value={cp.calfTag || ""} onChange={(v) => updateCalvingParity(idx, "calfTag", v)} />
                          <TextField label="Calf sire (auto)" value={cp.calfSire || getCalfSireForCalving(selectedAnimal, cp.parityNo) || ""} onChange={(v) => updateCalvingParity(idx, "calfSire", v)} />
                          <SelectField label="Calving outcome" value={cp.calvingOutcome || "Normal calving"} onChange={(v) => updateCalvingParity(idx, "calvingOutcome", v)} options={CALVING_OUTCOMES} />
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

                {detailTab === "production" && selectedLactation && (
                  <div className="stack-gap">
                    <Grid>
                      <SelectField
                        label="Select parity"
                        value={selectedAnimal.femaleDetails.selectedProductionParity}
                        onChange={selectProductionParity}
                        options={selectedAnimal.femaleDetails.productionLactations.map((l) => l.parityNo)}
                      />
                      <TextField label="Calving date" value={selectedLactation.calvingDate || selectedAnimal.femaleDetails.calvingParities.find((c) => c.parityNo === selectedLactation.parityNo)?.calvingDate || ""} onChange={() => {}} readOnly />
                      <TextField label="Dry date" value={selectedLactation.dryDate || ""} onChange={(v) => updateSelectedLactation("dryDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" />
                      <SelectField label="Entry mode" value={selectedLactation.entryMode || "Manual"} onChange={(v) => updateSelectedLactation("entryMode", v)} options={ENTRY_MODES} />
                    </Grid>

                    {selectedLactation.entryMode === "Manual" ? (
                      <Grid>
                        <TextField label="Total lactation milk" value={selectedLactation.manualSummary.totalLactationMilk || ""} onChange={(v) => updateManualSummary("totalLactationMilk", v)} />
                        <TextField label="Standard lactation milk" value={selectedLactation.manualSummary.standardLactationMilk || ""} onChange={(v) => updateManualSummary("standardLactationMilk", v)} />
                        <TextField label="Peak yield" value={selectedLactation.manualSummary.peakYield || ""} onChange={(v) => updateManualSummary("peakYield", v)} />
                      </Grid>
                    ) : (
                      <div className="stack-gap">
                        <div className="subsection-label">First recordable Friday: {firstRecordableFriday(selectedLactation.calvingDate || selectedAnimal.femaleDetails.calvingParities.find((c) => c.parityNo === selectedLactation.parityNo)?.calvingDate || "") || "—"}</div>
                        {(selectedLactation.fridayRecords || []).length === 0 && <div className="empty-note">No Friday records yet.</div>}
                        {(selectedLactation.fridayRecords || []).map((rec, idx) => (
                          <div key={`fr-${idx}`} className="mini-card">
                            <Grid>
                              <TextField label={`Friday ${idx + 1} date`} value={rec.date || ""} onChange={() => {}} readOnly />
                              <TextField label="Morning milk" value={rec.morningMilk || ""} onChange={(v) => updateFridayRecord(idx, "morningMilk", v)} />
                              <TextField label="Evening milk" value={rec.eveningMilk || ""} onChange={(v) => updateFridayRecord(idx, "eveningMilk", v)} />
                              <TextField label="Total Daily Yield" value={rec.totalDailyYield || ""} onChange={() => {}} readOnly />
                              <TextField label="Fat %" value={rec.fatPct || ""} onChange={(v) => updateFridayRecord(idx, "fatPct", v)} />
                              <TextField label="SNF %" value={rec.snfPct || ""} onChange={(v) => updateFridayRecord(idx, "snfPct", v)} />
                              <TextField label="TS %" value={rec.tsPct || ""} onChange={(v) => updateFridayRecord(idx, "tsPct", v)} />
                            </Grid>
                          </div>
                        ))}
                        <div className="action-row">
                          <button className="primary-btn" onClick={addFridayRecord}>Add Friday record</button>
                          <button className="secondary-btn" onClick={removeFridayRecord}>Remove last Friday</button>
                        </div>
                      </div>
                    )}

                    <Grid>
                      <TextField label="Lactation length (days)" value={String(productionMetrics.lactationLength || "")} onChange={() => {}} readOnly />
                      <TextField label="Total lactation milk" value={String(productionMetrics.totalLactationMilk || "")} onChange={() => {}} readOnly />
                      <TextField label="Standard lactation milk" value={String(productionMetrics.standardLactationMilk || "")} onChange={() => {}} readOnly />
                      <TextField label="Peak yield" value={String(productionMetrics.peakYield || "")} onChange={() => {}} readOnly />
                    </Grid>
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
