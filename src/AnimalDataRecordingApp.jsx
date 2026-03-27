import React, { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const BREEDS = ["Murrah buffalo", "Nili-Ravi buffalo"];
const SEX_OPTIONS = ["Female", "Male"];
const STATUS_OPTIONS = ["Active (present in herd)", "Dead", "Culled"];
const FEMALE_TABS = ["pedigree", "reproduction", "calving", "production", "health", "history"];
const MALE_TABS = ["pedigree", "disease testing", "progenies born", "performance of daughters", "health", "overall history sheet"];
const AI_RESULTS = ["Pending", "Negative", "Conceived"];
const CALVING_OUTCOMES = ["Normal calving", "Stillbirth", "Abortion"];
const ENTRY_MODES = ["Manual", "Friday Records"];
const HEALTH_SUBTABS = [
  { id: "bodyWeight", label: "Body Weight" },
  { id: "deworming", label: "Deworming" },
  { id: "vaccination", label: "Vaccination" },
  { id: "treatment", label: "Treatment" },
];
const MALE_PROGENY_SUBTABS = [
  { id: "female", label: "Female progenies" },
  { id: "male", label: "Male progenies" },
];
const DAUGHTER_PERF_SUBTABS = [
  { id: "production", label: "Production" },
  { id: "reproduction", label: "Reproduction" },
];
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

function makeReproParity(parityNo) { return { parityNo: String(parityNo), conceptionDate: "", expectedCalvingDate: "", remarks: "", aiRecords: [] }; }
function makeCalvingParity(parityNo) { return { parityNo: String(parityNo), calvingDate: "", calfSex: "", calfTag: "", calfSire: "", calvingOutcome: "Normal calving", remarks: "" }; }
function makeFridayRecord(date = "") { return { date, morningMilk: "", eveningMilk: "", totalDailyYield: "", fatPct: "", snfPct: "", tsPct: "" }; }
function makeProductionLactation(parityNo) { return { parityNo: String(parityNo), entryMode: "Manual", calvingDate: "", dryDate: "", manualSummary: { totalLactationMilk: "", standardLactationMilk: "", peakYield: "" }, fridayRecords: [] }; }
function makeBodyWeightRecord() { return { recordDate: "", bodyWeight: "" }; }
function makeDewormingRecord() { return { dewormingDate: "", anthelminticUsed: "" }; }
function makeVaccinationRecord() { return { vaccinationDate: "", vaccineUsed: "" }; }
function makeTreatmentRecord() { return { treatmentDate: "", diagnosis: "", treatmentGiven: "" }; }
function makeDiseaseTestRecord() { return { testDate: "", testName: "", result: "", remarks: "" }; }

function parseDisplayDate(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.trim().split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}
function formatDateDisplay(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}
function normalizeDisplayDate(value) { const dt = parseDisplayDate(value); return dt ? formatDateDisplay(dt) : value; }
function addDays(dateStr, days) { const dt = parseDisplayDate(dateStr); if (!dt) return ""; const c = new Date(dt); c.setDate(c.getDate() + days); return formatDateDisplay(c); }
function daysBetween(start, end) { const a = parseDisplayDate(start), b = parseDisplayDate(end); if (!a || !b) return 0; return Math.max(0, Math.round((b - a) / 86400000)); }
function normalizeRomanInput(value) { return (value || "").toUpperCase().replace(/[^IVXLCDM]/g, ""); }
function isArchivedAnimal(animal) { return (animal?.status === "Dead" || animal?.status === "Culled") && Boolean((animal?.exitDate || "").trim()) && Boolean((animal?.exitReason || "").trim()); }
function normalizeAnimalFormData(form) {
  const next = { ...form };
  if (next.status === "Active (present in herd)") { next.exitDate = ""; next.exitReason = ""; }
  if (next.category !== "Male") { next.isBreedingBull = "No"; next.breedingSet = ""; }
  else { next.isBreedingBull = next.isBreedingBull || "No"; next.breedingSet = next.isBreedingBull === "Yes" ? normalizeRomanInput(next.breedingSet || "") : ""; }
  return next;
}
function getFemaleLifecycle(animal) {
  if (!animal || animal.category !== "Female") return animal?.category || "";
  const calvings = animal?.femaleDetails?.calvingParities || [];
  const last = [...calvings].filter((p) => p.calvingDate && p.calvingOutcome === "Normal calving").sort((a, b) => {
    const ad = parseDisplayDate(a.calvingDate), bd = parseDisplayDate(b.calvingDate); if (!ad || !bd) return 0; return bd - ad;
  })[0];
  if (!last?.calvingDate) return "Heifer";
  const calving = parseDisplayDate(last.calvingDate); if (!calving) return "Heifer";
  const days = Math.max(0, Math.round((new Date() - calving) / 86400000));
  if (days < COLOSTRUM_DAYS) return animal.preCalvingLifecycle === "Heifer" ? "Colostrum-Heifer" : "Colostrum";
  return animal.preCalvingLifecycle === "Heifer" ? "Dry" : "Milk";
}

function normalizeLineageAcrossHerd(animals) {
  return (animals || []).map((animal) => {
    if (animal.category !== "Female" && animal.category !== "Male") return animal;
    if (animal.id && animal.id.toString().startsWith("calf-")) return animal;
    const inferred = inferLinkedSireFromStoredData(animal, animals);
    if (!inferred.linkedSireTag) return animal;
    return {
      ...animal,
      linkedSireTag: animal.linkedSireTag || inferred.linkedSireTag,
      linkedSireSet: animal.linkedSireSet || inferred.linkedSireSet,
    };
  });
}
function sortByTag(a, b) {
  const an = Number(a.tagNo), bn = Number(b.tagNo);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a.tagNo).localeCompare(String(b.tagNo), undefined, { numeric: true, sensitivity: "base" });
}
function firstRecordableFriday(calvingDate) {
  const base = parseDisplayDate(calvingDate); if (!base) return "";
  for (let i = 0; i <= 14; i++) {
    const d = new Date(base); d.setDate(d.getDate() + i);
    const cand = formatDateDisplay(d), gap = daysBetween(calvingDate, cand);
    if (d.getDay() === 5 && gap > 5) return cand;
  }
  return "";
}
function recalcFridayRecord(record) {
  const hasMilk = record.morningMilk !== "" || record.eveningMilk !== "";
  const total = Number(record.morningMilk || 0) + Number(record.eveningMilk || 0);
  return { ...record, totalDailyYield: hasMilk ? String(total) : record.totalDailyYield || "" };
}
function defaultHealth() {
  return {
    bodyWeightRecords: [makeBodyWeightRecord()],
    dewormingRecords: [makeDewormingRecord()],
    vaccinationRecords: [makeVaccinationRecord()],
    treatmentRecords: [makeTreatmentRecord()],
  };
}
function defaultMaleDetails() {
  return {
    pedigree: { ...emptyPedigree },
    diseaseTests: [makeDiseaseTestRecord()],
    health: defaultHealth(),
    historyMeta: { remarks: "", bookValue: "" },
  };
}
function withDefaults(animal) {
  return {
    ...animal,
    femaleDetails: animal.category === "Female" ? {
      pedigree: { ...emptyPedigree, ...(animal.femaleDetails?.pedigree || {}) },
      reproductionParities: animal.femaleDetails?.reproductionParities?.length ? animal.femaleDetails.reproductionParities.map((p) => ({ ...p, aiRecords: (p.aiRecords || []).map((r) => ({ ...r })) })) : [makeReproParity(0)],
      selectedReproParity: animal.femaleDetails?.selectedReproParity || "0",
      calvingParities: animal.femaleDetails?.calvingParities?.length ? animal.femaleDetails.calvingParities.map((p) => ({ ...p })) : [makeCalvingParity(1)],
      productionLactations: animal.femaleDetails?.productionLactations?.length ? animal.femaleDetails.productionLactations.map((l) => ({ ...l, calvingDate: l.calvingDate || "", manualSummary: { totalLactationMilk: "", standardLactationMilk: "", peakYield: "", ...(l.manualSummary || {}) }, fridayRecords: (l.fridayRecords || []).map((r) => recalcFridayRecord({ ...r })) })) : [makeProductionLactation(1)],
      selectedProductionParity: animal.femaleDetails?.selectedProductionParity || "1",
      historyMeta: { reasonForCulling: "", bookValue: "", ...(animal.femaleDetails?.historyMeta || {}) },
      health: {
        ...defaultHealth(),
        ...(animal.femaleDetails?.health || {}),
        bodyWeightRecords: animal.femaleDetails?.health?.bodyWeightRecords?.length ? animal.femaleDetails.health.bodyWeightRecords.map((r) => ({ ...r })) : [makeBodyWeightRecord()],
        dewormingRecords: animal.femaleDetails?.health?.dewormingRecords?.length ? animal.femaleDetails.health.dewormingRecords.map((r) => ({ ...r })) : [makeDewormingRecord()],
        vaccinationRecords: animal.femaleDetails?.health?.vaccinationRecords?.length ? animal.femaleDetails.health.vaccinationRecords.map((r) => ({ ...r })) : [makeVaccinationRecord()],
        treatmentRecords: animal.femaleDetails?.health?.treatmentRecords?.length ? animal.femaleDetails.health.treatmentRecords.map((r) => ({ ...r })) : [makeTreatmentRecord()],
      },
    } : undefined,
    maleDetails: animal.category === "Male" ? {
      ...defaultMaleDetails(),
      ...(animal.maleDetails || {}),
      pedigree: { ...emptyPedigree, ...(animal.maleDetails?.pedigree || {}) },
      diseaseTests: animal.maleDetails?.diseaseTests?.length ? animal.maleDetails.diseaseTests.map((r) => ({ ...r })) : [makeDiseaseTestRecord()],
      health: {
        ...defaultHealth(),
        ...(animal.maleDetails?.health || {}),
        bodyWeightRecords: animal.maleDetails?.health?.bodyWeightRecords?.length ? animal.maleDetails.health.bodyWeightRecords.map((r) => ({ ...r })) : [makeBodyWeightRecord()],
        dewormingRecords: animal.maleDetails?.health?.dewormingRecords?.length ? animal.maleDetails.health.dewormingRecords.map((r) => ({ ...r })) : [makeDewormingRecord()],
        vaccinationRecords: animal.maleDetails?.health?.vaccinationRecords?.length ? animal.maleDetails.health.vaccinationRecords.map((r) => ({ ...r })) : [makeVaccinationRecord()],
        treatmentRecords: animal.maleDetails?.health?.treatmentRecords?.length ? animal.maleDetails.health.treatmentRecords.map((r) => ({ ...r })) : [makeTreatmentRecord()],
      },
      historyMeta: { remarks: "", bookValue: "", ...(animal.maleDetails?.historyMeta || {}) },
    } : undefined,
  };
}
function formatBullSet(aiRecord) { if (!aiRecord) return ""; const bullNo = (aiRecord.aiBullNo || "").trim(); const setNo = (aiRecord.aiSetNo || "").trim(); if (bullNo && setNo) return `${bullNo}/${setNo}`; return bullNo || setNo || ""; }

function splitSireString(value) {
  const raw = (value || "").trim();
  if (!raw) return { bullNo: "", setNo: "" };
  const parts = raw.split("/").map((s) => s.trim()).filter(Boolean);
  return { bullNo: parts[0] || "", setNo: parts[1] || "" };
}


function getAnimalDisplayCategory(animal) {
  return animal?.category === "Female" ? getFemaleLifecycle(animal) : (animal?.isBreedingBull === "Yes" ? `Breeding Bull (${animal?.breedingSet || "Set blank"})` : "Male");
}
function getLinkedBullByAnimal(animal, allAnimals) {
  if (!animal) return null;
  const sireTag = animal.linkedSireTag || inferLinkedSireFromStoredData(animal, allAnimals).linkedSireTag || "";
  if (!sireTag) return null;
  return (allAnimals || []).find((a) => a.category === "Male" && a.tagNo === sireTag) || null;
}
function exportBullHistoryPdf(bull, femaleProgenies, maleProgenies) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text("BREEDING BULL HISTORY SHEET", 148, 12, { align: "center" });
  doc.setFontSize(10);
  doc.text("ICAR-CENTRAL INSTITUTE FOR RESEARCH ON BUFFALOES", 148, 18, { align: "center" });
  doc.text("SUB-CAMPUS, NABHA PUNJAB 147201", 148, 23, { align: "center" });

  doc.setFontSize(9);
  doc.text(`Bull No.: ${bull?.tagNo || ""}`, 14, 32);
  doc.text(`Breed: ${bull?.breed || ""}`, 60, 32);
  doc.text(`DOB: ${bull?.dob || ""}`, 105, 32);
  doc.text(`Breeding Set: ${bull?.breedingSet || ""}`, 145, 32);
  doc.text(`Book Value: ${bull?.maleDetails?.historyMeta?.bookValue || ""}`, 215, 32);

  autoTable(doc, {
    startY: 38,
    styles: { fontSize: 7, cellPadding: 1.4, overflow: "linebreak" },
    headStyles: { fillColor: [220, 245, 232], textColor: 20, fontStyle: "bold" },
    theme: "grid",
    head: [["Section", "Value"]],
    body: [
      ["Total female progenies", String(femaleProgenies.length)],
      ["Total male progenies", String(maleProgenies.length)],
      ["Archived linked progenies", String([...femaleProgenies, ...maleProgenies].filter((a) => isArchivedAnimal(a)).length)],
      ["Daughters in milk", String(femaleProgenies.filter((a) => getFemaleLifecycle(a) === "Milk").length)],
      ["Remarks", bull?.maleDetails?.historyMeta?.remarks || ""],
      ["Lineage model", "ID + text fallback"],
    ],
    margin: { left: 10, right: 10 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 6,
    styles: { fontSize: 6.5, cellPadding: 1.1, overflow: "linebreak" },
    headStyles: { fillColor: [220, 245, 232], textColor: 20, fontStyle: "bold" },
    theme: "grid",
    head: [["Progeny Type", "Tag No.", "DOB", "Current Category / Status", "Dam", "Sire Link"]],
    body: [
      ...femaleProgenies.map((a) => [
        "Female",
        a.tagNo || "",
        a.dob || "",
        getFemaleLifecycle(a),
        a.femaleDetails?.pedigree?.dam || "",
        `${a.linkedSireTag || ""}${a.linkedSireSet ? "/" + a.linkedSireSet : ""}`,
      ]),
      ...maleProgenies.map((a) => [
        "Male",
        a.tagNo || "",
        a.dob || "",
        a.status || "",
        a.maleDetails?.pedigree?.dam || "",
        `${a.linkedSireTag || ""}${a.linkedSireSet ? "/" + a.linkedSireSet : ""}`,
      ]),
    ],
    margin: { left: 10, right: 10 },
  });

  doc.save(`breeding-bull-history-sheet-${bull?.tagNo || "bull"}.pdf`);
}
function inferLinkedSireFromStoredData(animal, allAnimals) {
  const sireText = animal?.category === "Female"
    ? animal.femaleDetails?.pedigree?.sire || ""
    : animal?.maleDetails?.pedigree?.sire || "";
  const parsed = splitSireString(sireText);
  if (!parsed.bullNo) return { linkedSireTag: "", linkedSireSet: "" };
  const matchingBull = (allAnimals || []).find((a) => a.category === "Male" && a.tagNo === parsed.bullNo);
  return {
    linkedSireTag: matchingBull?.tagNo || parsed.bullNo,
    linkedSireSet: parsed.setNo || matchingBull?.breedingSet || "",
  };
}
function bullLineageMatches(animal, bull) {
  if (!animal || !bull) return false;
  const lineageBullTag = animal.linkedSireTag || "";
  const lineageBullSet = animal.linkedSireSet || "";
  if (lineageBullTag && lineageBullTag === bull.tagNo) {
    if (!bull.breedingSet) return true;
    if (!lineageBullSet) return true;
    return lineageBullSet === bull.breedingSet;
  }
  const sireText = animal.category === "Female"
    ? animal.femaleDetails?.pedigree?.sire || ""
    : animal.maleDetails?.pedigree?.sire || "";
  const parsed = splitSireString(sireText);
  if (!parsed.bullNo) return false;
  if (parsed.bullNo !== bull.tagNo) return false;
  if (!bull.breedingSet || !parsed.setNo) return true;
  return parsed.setNo === bull.breedingSet;
}
function summarizeDaughterProduction(daughters) {
  const lactations = daughters.flatMap((a) => (a.femaleDetails?.productionLactations || []).map((l) => ({ animal: a, lactation: l })));
  const computed = lactations.map(({ animal, lactation }) => ({ animal, lactation, metrics: computeProductionMetrics(lactation) }));
  const totalTLMY = computed.reduce((s, x) => s + Number(x.metrics.totalLactationMilk || 0), 0);
  const totalSLMY = computed.reduce((s, x) => s + Number(x.metrics.standardLactationMilk || 0), 0);
  const maxPeak = computed.reduce((m, x) => Math.max(m, Number(x.metrics.peakYield || 0)), 0);
  return {
    daughterCount: daughters.length,
    lactationCount: computed.length,
    totalTLMY,
    totalSLMY,
    maxPeak,
    averageTLMY: computed.length ? Math.round((totalTLMY / computed.length) * 100) / 100 : 0,
    averageSLMY: computed.length ? Math.round((totalSLMY / computed.length) * 100) / 100 : 0,
  };
}
function summarizeDaughterReproduction(daughters) {
  const parities = daughters.flatMap((a) => (a.femaleDetails?.reproductionParities || []).map((r) => ({ animal: a, repro: r })));
  const conceived = parities.filter((x) => Boolean(x.repro.conceptionDate)).length;
  const services = parities.reduce((s, x) => s + Number((x.repro.aiRecords || []).length), 0);
  return {
    daughterCount: daughters.length,
    parityCount: parities.length,
    conceivedCount: conceived,
    totalServices: services,
    avgServicesPerParity: parities.length ? Math.round((services / parities.length) * 100) / 100 : 0,
  };
}
function getReproParityByNo(animal, parityNo) { return animal?.femaleDetails?.reproductionParities?.find((p) => Number(p.parityNo) === Number(parityNo)) || null; }
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
function getCalfSireForCalving(animal, calvingParityNo) { const sourceReproParity = Number(calvingParityNo) - 1; if (sourceReproParity < 0) return ""; const reproParity = getReproParityByNo(animal, sourceReproParity); return formatBullSet(getConceivedAIRecord(reproParity)); }
function getCalvingDateForParity(animal, parityNo) { return animal?.femaleDetails?.calvingParities?.find((c) => Number(c.parityNo) === Number(parityNo))?.calvingDate || ""; }
function computeCalvingMetrics(animal, calvingParityNo) {
  const p = Number(calvingParityNo), currentCalving = getCalvingDateForParity(animal, p), previousCalving = getCalvingDateForParity(animal, p - 1), previousRepro = getReproParityByNo(animal, p - 1);
  let afc = "", gestationPeriod = "", servicePeriod = "", calvingInterval = "";
  if (p === 1 && animal?.dob && currentCalving) afc = String(daysBetween(animal.dob, currentCalving));
  if (previousRepro?.conceptionDate && currentCalving) gestationPeriod = String(daysBetween(previousRepro.conceptionDate, currentCalving));
  if (p >= 2 && previousCalving && previousRepro?.conceptionDate) servicePeriod = String(daysBetween(previousCalving, previousRepro.conceptionDate));
  if (p >= 2 && previousCalving && currentCalving) calvingInterval = String(daysBetween(previousCalving, currentCalving));
  return { afc, gestationPeriod, servicePeriod, calvingInterval };
}
function buildAutoCalfAnimal(dam, calvingParity) {
  if (!dam || dam.category !== "Female") return null;
  if ((calvingParity?.calvingOutcome || "") !== "Normal calving") return null;
  const calfTag = (calvingParity?.calfTag || "").trim(), calfSex = calvingParity?.calfSex || "", calfDob = calvingParity?.calvingDate || "";
  const calfSire = (calvingParity?.calfSire || getCalfSireForCalving(dam, calvingParity?.parityNo) || "").trim();
  if (!calfTag || !calfSex || !calfDob) return null;
  const sireParts = splitSireString(calfSire);
  const base = { id: `calf-${dam.id}-${calvingParity.parityNo}`, tagNo: calfTag, breed: dam.breed || "Nili-Ravi buffalo", dob: calfDob, category: calfSex === "Female" ? "Female" : "Male", identificationMark: "", status: "Active (present in herd)", exitDate: "", exitReason: "", isBreedingBull: "No", breedingSet: "", linkedDamId: dam.id, linkedCalvingParityNo: String(calvingParity.parityNo), linkedSireTag: sireParts.bullNo || "", linkedSireSet: sireParts.setNo || "", autoAddedFromBirth: true, preCalvingLifecycle: "Heifer" };
  if (calfSex === "Female") {
    return withDefaults({ ...base, femaleDetails: { pedigree: { ...emptyPedigree, dam: dam.tagNo || "", sire: calfSire }, reproductionParities: [makeReproParity(0)], selectedReproParity: "0", calvingParities: [makeCalvingParity(1)], productionLactations: [makeProductionLactation(1)], selectedProductionParity: "1", historyMeta: { reasonForCulling: "", bookValue: "" }, health: defaultHealth() } });
  }
  return withDefaults({ ...base, maleDetails: { ...defaultMaleDetails(), pedigree: { ...emptyPedigree, dam: dam.tagNo || "", sire: calfSire } } });
}
function syncDamCalvesInHerd(animals, dam) {
  if (!dam || dam.category !== "Female") return animals;
  const calfRecords = (dam.femaleDetails?.calvingParities || []).map((cp) => buildAutoCalfAnimal(dam, cp)).filter(Boolean);
  let nextAnimals = animals.filter((animal) => !animal?.autoAddedFromBirth || animal?.linkedDamId !== dam.id || calfRecords.some((calf) => calf.id === animal.id));
  calfRecords.forEach((calf) => {
    const idx = nextAnimals.findIndex((animal) => animal.id === calf.id || (animal.tagNo === calf.tagNo && animal.id !== dam.id));
    if (idx >= 0) nextAnimals[idx] = withDefaults({ ...nextAnimals[idx], ...calf, femaleDetails: calf.category === "Female" ? calf.femaleDetails : nextAnimals[idx].femaleDetails, maleDetails: calf.category === "Male" ? calf.maleDetails : nextAnimals[idx].maleDetails });
    else nextAnimals = [calf, ...nextAnimals];
  });
  return nextAnimals.sort(sortByTag);
}
function getNextFridayRecordDate(lactation) { const existing = lactation?.fridayRecords || []; if (!existing.length) return firstRecordableFriday(lactation?.calvingDate || ""); const lastDate = existing[existing.length - 1]?.date || ""; return lastDate ? addDays(lastDate, 7) : ""; }
function computeProductionMetrics(lactation) {
  if (!lactation) return { lactationLength: 0, totalLactationMilk: 0, standardLactationMilk: 0, peakYield: 0 };
  const calvingDate = lactation.calvingDate || "", dryDate = lactation.dryDate || "";
  const lactationLength = calvingDate && dryDate ? daysBetween(calvingDate, dryDate) + 1 : 0;
  if (lactation.entryMode === "Manual") return { lactationLength, totalLactationMilk: Number(lactation.manualSummary.totalLactationMilk || 0), standardLactationMilk: Number(lactation.manualSummary.standardLactationMilk || 0), peakYield: Number(lactation.manualSummary.peakYield || 0) };
  const records = [...(lactation.fridayRecords || [])].filter((r) => r.date);
  let total = 0, standard = 0, peak = 0, standardUsed = 0;
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
function computeHistoryRows(animal) {
  const rows = [];
  const repros = animal?.femaleDetails?.reproductionParities || [], calvings = animal?.femaleDetails?.calvingParities || [], lactations = animal?.femaleDetails?.productionLactations || [];
  const maxParity = Math.max(1, ...repros.map((p) => Number(p.parityNo || 0)), ...calvings.map((p) => Number(p.parityNo || 0)), ...lactations.map((p) => Number(p.parityNo || 0)));
  for (let p = 0; p <= maxParity; p++) {
    const repro = repros.find((r) => Number(r.parityNo) === p) || null;
    const calving = calvings.find((c) => Number(c.parityNo) === p) || null;
    const lactation = lactations.find((l) => Number(l.parityNo) === p) || null;
    const prod = lactation ? computeProductionMetrics(lactation) : null;
    const aiRecords = repro?.aiRecords || [];
    const firstAI = aiRecords[0]?.aiDate || "";
    const bullNo = formatBullSet(getConceivedAIRecord(repro) || aiRecords[aiRecords.length - 1]);
    const totalAI = aiRecords.length ? String(aiRecords.length) : "";
    const metrics = p >= 1 ? computeCalvingMetrics(animal, p) : { afc: "", gestationPeriod: "", servicePeriod: "", calvingInterval: "" };
    rows.push({ parity: String(p), dateCalved: calving?.calvingDate || "", gp: metrics.gestationPeriod, sexOfCalf: calving?.calvingOutcome === "Normal calving" ? calving?.calfSex || "" : calving?.calvingOutcome || "", calfTag: calving?.calfTag || "", firstAI, conceptionDate: repro?.conceptionDate || "", bullNo, totalAI, dryDate: lactation?.dryDate || "", tlmy: lactation ? String(prod?.totalLactationMilk || "") : "", slmy: lactation ? String(prod?.standardLactationMilk || "") : "", ll: lactation && lactation.dryDate ? String(prod?.lactationLength || "") : "", py: lactation ? String(prod?.peakYield || "") : "", sp: metrics.servicePeriod, ci: metrics.calvingInterval, fat: "", snf: "", ts: "" });
  }
  return rows;
}
function exportHistoryPdf(animal) {
  const rows = computeHistoryRows(animal);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14); doc.text("BUFFALO HISTORY SHEET", 148, 12, { align: "center" });
  doc.setFontSize(10); doc.text("ICAR-CENTRAL INSTITUTE FOR RESEARCH ON BUFFALOES", 148, 18, { align: "center" });
  doc.text("SUB-CAMPUS, NABHA PUNJAB 147201", 148, 23, { align: "center" });
  const afc = computeCalvingMetrics(animal, 1).afc || "";
  doc.setFontSize(9);
  doc.text(`Animal No.: ${animal.tagNo || ""}`, 14, 32);
  doc.text(`Date of Birth: ${animal.dob || ""}`, 70, 32);
  doc.text(`AFC (days): ${afc}`, 120, 32);
  doc.text(`Reason for culling: ${animal?.femaleDetails?.historyMeta?.reasonForCulling || ""}`, 165, 32);
  doc.text(`Book Value: ${animal?.femaleDetails?.historyMeta?.bookValue || ""}`, 235, 32);
  autoTable(doc, {
    startY: 36,
    styles: { fontSize: 6.5, cellPadding: 1.2, overflow: "linebreak" },
    headStyles: { fillColor: [220, 245, 232], textColor: 20, fontStyle: "bold" },
    theme: "grid",
    head: [["Parity", "Date Calved", "GP", "Sex of Calf", "Tag No. of Calf", "Date of 1st A.I", "Date of Conception", "Bull No./Set No.", "Total no. of AI", "Dry Date", "TLMY", "SLMY", "LL", "PY", "SP", "CI", "Fat %", "SNF %", "TS %"]],
    body: rows.map((r) => [r.parity, r.dateCalved, r.gp, r.sexOfCalf, r.calfTag, r.firstAI, r.conceptionDate, r.bullNo, r.totalAI, r.dryDate, r.tlmy, r.slmy, r.ll, r.py, r.sp, r.ci, r.fat, r.snf, r.ts]),
    margin: { left: 8, right: 8 },
  });
  doc.save(`buffalo-history-sheet-${animal.tagNo || "animal"}.pdf`);
}


function validateAnimalForm(form) {
  const errors = [];
  if (!(form.tagNo || "").trim()) errors.push("Tag No. is required.");
  if (form.category === "Male" && form.isBreedingBull === "Yes" && !(form.breedingSet || "").trim()) {
    errors.push("Breeding set is required for breeding bulls.");
  }
  if (form.status !== "Active (present in herd)") {
    if (!(form.exitDate || "").trim()) errors.push("Date of Death / Culling is required.");
    if (!(form.exitReason || "").trim()) errors.push("Reason of Death / Culling is required.");
  }
  return errors;
}

function validateCurrentTab(selectedAnimal, detailTab) {
  const errors = [];
  if (!selectedAnimal || !detailTab) return errors;

  if (selectedAnimal.category === "Female") {
    if (detailTab === "pedigree") {
      if (!(selectedAnimal.femaleDetails?.pedigree?.dam || "").trim()) errors.push("Female pedigree: Dam is required.");
      if (!(selectedAnimal.femaleDetails?.pedigree?.sire || "").trim()) errors.push("Female pedigree: Sire is required.");
    }
    if (detailTab === "reproduction") {
      const selectedRepro = selectedAnimal.femaleDetails?.reproductionParities?.find(
        (p) => p.parityNo === selectedAnimal.femaleDetails?.selectedReproParity
      );
      if (selectedRepro) {
        const aiRecords = selectedRepro.aiRecords || [];
        if (aiRecords.length > 0) {
          aiRecords.forEach((r, idx) => {
            if (!(r.aiDate || "").trim()) errors.push(`Reproduction: AI ${idx + 1} date is required.`);
            if (!(r.aiBullNo || "").trim()) errors.push(`Reproduction: AI ${idx + 1} Bull No. is required.`);
          });
        }
      }
    }
    if (detailTab === "calving") {
      (selectedAnimal.femaleDetails?.calvingParities || []).forEach((cp, idx) => {
        if ((cp.calfTag || cp.calfSex || cp.calvingOutcome === "Normal calving") && !(cp.calvingDate || "").trim()) {
          errors.push(`Calving parity ${idx + 1}: Calving date is required.`);
        }
      });
    }
    if (detailTab === "production") {
      const selectedLactation = selectedAnimal.femaleDetails?.productionLactations?.find(
        (l) => l.parityNo === selectedAnimal.femaleDetails?.selectedProductionParity
      );
      if (selectedLactation?.entryMode === "Friday Records") {
        (selectedLactation.fridayRecords || []).forEach((r, idx) => {
          if (!(r.date || "").trim()) errors.push(`Production: Friday ${idx + 1} date is required.`);
        });
      }
    }
  }

  if (selectedAnimal.category === "Male" && selectedAnimal.isBreedingBull === "Yes") {
    if (detailTab === "pedigree") {
      if (!(selectedAnimal.maleDetails?.pedigree?.dam || "").trim()) errors.push("Bull pedigree: Dam is required.");
      if (!(selectedAnimal.maleDetails?.pedigree?.sire || "").trim()) errors.push("Bull pedigree: Sire is required.");
    }
    if (detailTab === "disease testing") {
      (selectedAnimal.maleDetails?.diseaseTests || []).forEach((r, idx) => {
        if ((r.testName || r.result || r.testDate) && !(r.testDate || "").trim()) {
          errors.push(`Disease testing row ${idx + 1}: Test date is required.`);
        }
      });
    }
  }

  return errors;
}


const STORAGE_KEY = "buffalo_app_phase_4_data";
const SUPABASE_TABLE = "buffalo_app_records";
const SUPABASE_ROW_ID = "main";

function safeParseAnimals(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}


async function loadAnimalsFromSupabase() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("payload")
    .eq("id", SUPABASE_ROW_ID)
    .maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.payload) ? data.payload : [];
}

async function saveAnimalsToSupabase(animals) {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase
    .from(SUPABASE_TABLE)
    .upsert({ id: SUPABASE_ROW_ID, payload: animals }, { onConflict: "id" });
  if (error) throw error;
}
function exportJsonBackup(data) {
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "buffalo-app-backup.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function mergeAnimalsByIdOrTag(existing, incoming) {
  const next = [...existing];
  incoming.forEach((candidate) => {
    const idx = next.findIndex((a) => a.id === candidate.id || (a.tagNo && candidate.tagNo && a.tagNo === candidate.tagNo));
    if (idx >= 0) next[idx] = candidate;
    else next.push(candidate);
  });
  return next;
}
function Section({ title, children }) { return <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-md"><div className="mb-3 text-lg font-semibold text-emerald-900">{title}</div>{children}</div>; }
function Grid({ children }) { return <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{children}</div>; }
function TextField({ label, value, onChange, readOnly = false, placeholder = "" }) { return <label className="field"><span>{label}</span><input value={value} readOnly={readOnly} placeholder={placeholder} onChange={readOnly ? undefined : (e) => onChange(e.target.value)} /></label>; }
function SelectField({ label, value, onChange, options, disabled = false }) { return <label className="field"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>{options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}</select></label>; }
function TextAreaField({ label, value, onChange, rows = 3 }) { return <label className="field textarea-field"><span>{label}</span><textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function StatCard({ title, value }) { return <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-md"><div className="text-sm text-emerald-700">{title}</div><div className="text-2xl font-semibold text-emerald-900">{value}</div></div>; }

export default function AnimalDataRecordingApp() {
  const [animals, setAnimals] = useState(() => {
    if (typeof window === "undefined") return [];
    return safeParseAnimals(window.localStorage.getItem(STORAGE_KEY));
  });
  const [storageMode, setStorageMode] = useState(isSupabaseConfigured ? "Supabase + Local Backup" : "Browser Local Storage");
  const [isInitialSyncComplete, setIsInitialSyncComplete] = useState(false);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [herdView, setHerdView] = useState("current");
  const [detailTab, setDetailTab] = useState("pedigree");
  const [healthSubTab, setHealthSubTab] = useState("bodyWeight");
  const [maleProgenySubTab, setMaleProgenySubTab] = useState("female");
  const [daughterPerfSubTab, setDaughterPerfSubTab] = useState("production");
  const [newAnimal, setNewAnimal] = useState({ ...emptyAnimal });
  const [isEditingAnimal, setIsEditingAnimal] = useState(false);
  const [editAnimalForm, setEditAnimalForm] = useState({ ...emptyAnimal });
  const [validationMessage, setValidationMessage] = useState("");
  const [archiveFilter, setArchiveFilter] = useState("All");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const fileInputRef = useRef(null);

  const normalizedAnimals = useMemo(() => normalizeLineageAcrossHerd(animals.map(withDefaults)), [animals]);
  const activeAnimals = useMemo(() => normalizedAnimals.filter((a) => !isArchivedAnimal(a)), [normalizedAnimals]);
  const archivedAnimals = useMemo(() => normalizedAnimals.filter((a) => isArchivedAnimal(a)), [normalizedAnimals]);
  const filteredCurrentAnimals = useMemo(() => {
    const q = search.toLowerCase();
    return activeAnimals.filter((a) => [a.tagNo, a.breed, a.category, a.status, a.identificationMark, a.isBreedingBull, a.breedingSet].join(" ").toLowerCase().includes(q));
  }, [activeAnimals, search]);
  const filteredArchivedAnimals = useMemo(() => {
    const q = search.toLowerCase();
    return archivedAnimals.filter((a) => {
      const matchesSearch = [a.tagNo, a.breed, a.category, a.status, a.exitDate, a.exitReason].join(" ").toLowerCase().includes(q);
      const matchesArchiveFilter =
        archiveFilter === "All" ||
        (archiveFilter === "Dead" && a.status === "Dead") ||
        (archiveFilter === "Culled" && a.status === "Culled") ||
        (archiveFilter === "Female" && a.category === "Female") ||
        (archiveFilter === "Male" && a.category === "Male");
      return matchesSearch && matchesArchiveFilter;
    });
  }, [archivedAnimals, search, archiveFilter]);
  const stats = useMemo(() => {
    const females = activeAnimals.filter((a) => a.category === "Female"), males = activeAnimals.filter((a) => a.category === "Male");
    return { totalAnimals: activeAnimals.length, femaleCount: females.length, maleCount: males.length, heiferCount: females.filter((a) => getFemaleLifecycle(a) === "Heifer").length, colostrumHeiferCount: females.filter((a) => getFemaleLifecycle(a) === "Colostrum-Heifer").length, colostrumCount: females.filter((a) => getFemaleLifecycle(a) === "Colostrum").length, milkCount: females.filter((a) => getFemaleLifecycle(a) === "Milk").length, dryCount: females.filter((a) => getFemaleLifecycle(a) === "Dry").length };
  }, [activeAnimals]);
  const selectedAnimal = normalizedAnimals.find((a) => a.id === selectedId) || null;
  const currentAnimalSummary = useMemo(() => {
    if (!selectedAnimal) return null;
    if (selectedAnimal.category === "Female") {
      const reproCount = (selectedAnimal.femaleDetails?.reproductionParities || []).length;
      const calvingCount = (selectedAnimal.femaleDetails?.calvingParities || []).length;
      const healthCount =
        (selectedAnimal.femaleDetails?.health?.bodyWeightRecords || []).length +
        (selectedAnimal.femaleDetails?.health?.dewormingRecords || []).length +
        (selectedAnimal.femaleDetails?.health?.vaccinationRecords || []).length +
        (selectedAnimal.femaleDetails?.health?.treatmentRecords || []).length;
      return {
        type: "female",
        cards: [
          ["Current Category", getFemaleLifecycle(selectedAnimal)],
          ["Repro Parities", reproCount],
          ["Calving Records", calvingCount],
          ["Health Entries", healthCount],
        ],
      };
    }
    if (selectedAnimal.category === "Male" && selectedAnimal.isBreedingBull === "Yes") {
      return {
        type: "male",
        cards: [
          ["Breeding Set", selectedAnimal.breedingSet || "—"],
          ["Female Progenies", femaleProgenies.length],
          ["Male Progenies", maleProgenies.length],
          ["Archived Linked", [...femaleProgenies, ...maleProgenies].filter((a) => isArchivedAnimal(a)).length],
        ],
      };
    }
    return {
      type: "male-basic",
      cards: [
        ["Status", selectedAnimal.status || "—"],
        ["Breed", selectedAnimal.breed || "—"],
        ["DOB", selectedAnimal.dob || "—"],
        ["Breeding Bull", selectedAnimal.isBreedingBull === "Yes" ? "Yes" : "No"],
      ],
    };
  }, [selectedAnimal, femaleProgenies, maleProgenies]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(animals));
  }, [animals]);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      if (!isSupabaseConfigured || !supabase) {
        if (active) {
          setStorageMode("Browser Local Storage");
          setIsInitialSyncComplete(true);
        }
        return;
      }
      try {
        const remoteAnimals = await loadAnimalsFromSupabase();
        if (!active) return;
        const localAnimals = safeParseAnimals(window.localStorage.getItem(STORAGE_KEY));
        const merged = normalizeLineageAcrossHerd(mergeAnimalsByIdOrTag(remoteAnimals || [], localAnimals || [])).sort(sortByTag);
        setAnimals(merged);
        if (merged.length && JSON.stringify(merged) !== JSON.stringify(remoteAnimals || [])) {
          await saveAnimalsToSupabase(merged);
        }
        setStorageMode("Supabase + Local Backup");
        setValidationMessage("Supabase storage connected.");
      } catch (error) {
        if (!active) return;
        setStorageMode("Browser Local Storage (Supabase unavailable)");
        setValidationMessage(`Supabase sync unavailable. Using browser storage only. ${error?.message || ""}`.trim());
      } finally {
        if (active) setIsInitialSyncComplete(true);
      }
    }
    bootstrap();
    return () => {
      active = false
    };
  }, []);

  useEffect(() => {
    if (!isInitialSyncComplete || !isSupabaseConfigured || !supabase) return;
    let cancelled = false;
    async function pushAnimals() {
      try {
        await saveAnimalsToSupabase(animals);
      } catch (error) {
        console.error("Supabase save failed", error);
      }
    }
    pushAnimals();
    return () => {
      cancelled = true;
    };
  }, [animals, isInitialSyncComplete]);

  function exportFullBackup() {
    exportJsonBackup(animals);
    setValidationMessage("Full JSON backup exported.");
  }

  function resetLocalData() {
    const confirmed = window.confirm("This will clear all app data saved in this browser. Continue?");
    if (!confirmed) return;
    setAnimals([]);
    setSelectedId(null);
    setValidationMessage(isSupabaseConfigured ? "Local browser data cleared. Use Sync Now to overwrite remote data if desired." : "All locally saved data cleared.");
  }

  function triggerImportBackup() {
    fileInputRef.current?.click();
  }

  function handleImportBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const incoming = safeParseAnimals(String(reader.result || ""));
      if (!incoming.length) {
        setValidationMessage("Import failed or file had no valid animal data.");
        return;
      }
      setAnimals((prev) => normalizeLineageAcrossHerd(mergeAnimalsByIdOrTag(prev, incoming)).sort(sortByTag));
      setValidationMessage(`Imported ${incoming.length} records from backup.${isSupabaseConfigured ? " Use Sync Now to push to database." : ""}`);
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  const visibleTabs = selectedAnimal?.category === "Female" ? FEMALE_TABS : selectedAnimal?.category === "Male" && selectedAnimal?.isBreedingBull === "Yes" ? MALE_TABS : [];
  const selectedReproParity = selectedAnimal?.femaleDetails?.reproductionParities?.find((p) => p.parityNo === selectedAnimal?.femaleDetails?.selectedReproParity) || null;
  const selectedLactation = selectedAnimal?.femaleDetails?.productionLactations?.find((l) => l.parityNo === selectedAnimal?.femaleDetails?.selectedProductionParity) || null;
  const productionMetrics = computeProductionMetrics(selectedLactation);
  const historyRows = selectedAnimal?.category === "Female" ? computeHistoryRows(selectedAnimal) : [];

  const femaleProgenies = useMemo(() => {
    if (!selectedAnimal || selectedAnimal.category !== "Male" || selectedAnimal.isBreedingBull !== "Yes") return [];
    return normalizedAnimals.filter((a) => a.category === "Female" && bullLineageMatches(a, selectedAnimal)).sort(sortByTag);
  }, [normalizedAnimals, selectedAnimal]);
  const maleProgenies = useMemo(() => {
    if (!selectedAnimal || selectedAnimal.category !== "Male" || selectedAnimal.isBreedingBull !== "Yes") return [];
    return normalizedAnimals.filter((a) => a.category === "Male" && a.id !== selectedAnimal.id && bullLineageMatches(a, selectedAnimal)).sort(sortByTag);
  }, [normalizedAnimals, selectedAnimal]);
  const daughterProductionSummary = useMemo(() => summarizeDaughterProduction(femaleProgenies), [femaleProgenies]);
  const daughterReproductionSummary = useMemo(() => summarizeDaughterReproduction(femaleProgenies), [femaleProgenies]);
  const dashboardData = useMemo(() => {
    const femaleAnimals = normalizedAnimals.filter((a) => a.category === "Female");
    const maleAnimals = normalizedAnimals.filter((a) => a.category === "Male");
    const breedingBulls = maleAnimals.filter((a) => a.isBreedingBull === "Yes");
    const archivedCount = normalizedAnimals.filter((a) => isArchivedAnimal(a)).length;
    return {
      femaleAnimals,
      maleAnimals,
      breedingBulls,
      archivedCount,
      pregnantFemales: femaleAnimals.filter((a) =>
        (a.femaleDetails?.reproductionParities || []).some((r) => Boolean(r.conceptionDate))
      ).length,
    };
  }, [normalizedAnimals]);

  function jumpToAnimalBySearch() {
    const q = (search || "").trim().toLowerCase();
    if (!q) return;
    const target = normalizedAnimals.find((a) =>
      [a.tagNo, a.breed, a.category, a.identificationMark, a.status].join(" ").toLowerCase().includes(q)
    );
    if (target) {
      setSelectedId(target.id);
      setHerdView(isArchivedAnimal(target) ? "archive" : "current");
      setDetailTab(target.category === "Female" ? "pedigree" : target.isBreedingBull === "Yes" ? "pedigree" : "");
      setValidationMessage(`Jumped to animal ${target.tagNo}.`);
    } else {
      setValidationMessage("No animal matched the current search.");
    }
  }

  function handleFormStatusChange(status) { setNewAnimal((s) => normalizeAnimalFormData({ ...s, status })); }
  function handleFormCategoryChange(category) { setNewAnimal((s) => normalizeAnimalFormData({ ...s, category })); }
  function addAnimal() {
    const prepared = normalizeAnimalFormData(newAnimal);
    const errors = validateAnimalForm(prepared);
    if (errors.length) { setValidationMessage(errors.join(" ")); return; }
    const item = withDefaults({
      id: Date.now(),
      ...prepared,
      preCalvingLifecycle: prepared.category === "Female" ? "Heifer" : "",
      femaleDetails: prepared.category === "Female" ? { pedigree: { ...emptyPedigree }, reproductionParities: [makeReproParity(0)], selectedReproParity: "0", calvingParities: [makeCalvingParity(1)], productionLactations: [makeProductionLactation(1)], selectedProductionParity: "1", historyMeta: { reasonForCulling: "", bookValue: "" }, health: defaultHealth() } : undefined,
      maleDetails: prepared.category === "Male" ? defaultMaleDetails() : undefined,
    });
    setAnimals((prev) => normalizeLineageAcrossHerd([item, ...prev]).sort(sortByTag));
    setSelectedId(item.id);
    setShowAdd(false);
    setValidationMessage("");
    setNewAnimal({ ...emptyAnimal });
  }
  function openEditAnimal() {
    if (!selectedAnimal) return;
    setEditAnimalForm({
      tagNo: selectedAnimal.tagNo || "",
      breed: selectedAnimal.breed || "Nili-Ravi buffalo",
      dob: selectedAnimal.dob || "",
      category: selectedAnimal.category || "Female",
      identificationMark: selectedAnimal.identificationMark || "",
      status: selectedAnimal.status || "Active (present in herd)",
      exitDate: selectedAnimal.exitDate || "",
      exitReason: selectedAnimal.exitReason || "",
      isBreedingBull: selectedAnimal.isBreedingBull || "No",
      breedingSet: selectedAnimal.breedingSet || "",
    });
    setValidationMessage("");
    setIsEditingAnimal(true);
  }
  function saveEditedAnimal() {
    if (!selectedAnimal) return;
    const prepared = normalizeAnimalFormData(editAnimalForm);
    const errors = validateAnimalForm(prepared);
    if (errors.length) { setValidationMessage(errors.join(" ")); return; }
    setAnimals((prev) => {
      const oldTag = selectedAnimal.tagNo;
      const oldSet = selectedAnimal.breedingSet || "";
      const next = prev.map((a) => {
        if (a.id === selectedAnimal.id) return withDefaults({ ...a, ...prepared });
        if (selectedAnimal.category === "Male" && a.linkedSireTag === oldTag) {
          const nextSireText = prepared.tagNo && prepared.breedingSet ? `${prepared.tagNo}/${prepared.breedingSet}` : prepared.tagNo || "";
          if (a.category === "Female") {
            return withDefaults({
              ...a,
              linkedSireTag: prepared.tagNo || a.linkedSireTag,
              linkedSireSet: prepared.breedingSet || "",
              femaleDetails: {
                ...a.femaleDetails,
                pedigree: { ...a.femaleDetails?.pedigree, sire: nextSireText || a.femaleDetails?.pedigree?.sire || "" },
              },
            });
          }
          if (a.category === "Male") {
            return withDefaults({
              ...a,
              linkedSireTag: prepared.tagNo || a.linkedSireTag,
              linkedSireSet: prepared.breedingSet || "",
              maleDetails: {
                ...a.maleDetails,
                pedigree: { ...a.maleDetails?.pedigree, sire: nextSireText || a.maleDetails?.pedigree?.sire || "" },
              },
            });
          }
        }
        return a;
      });
      return normalizeLineageAcrossHerd(next).sort(sortByTag);
    });
    setValidationMessage("");
    setIsEditingAnimal(false);
  }
  function goToNextTab() {
    const errors = validateCurrentTab(selectedAnimal, detailTab);
    if (errors.length) {
      setValidationMessage(errors.join(" "));
      return;
    }
    setValidationMessage("");
    const tabs = visibleTabs;
    const idx = tabs.indexOf(detailTab);
    if (idx >= 0 && idx < tabs.length - 1) setDetailTab(tabs[idx + 1]);
  }
  function submitTabs() {
    const errors = validateCurrentTab(selectedAnimal, detailTab);
    if (errors.length) {
      setValidationMessage(errors.join(" "));
      return;
    }
    setValidationMessage("Record submitted successfully.");
    alert("Record submitted.");
  }
  function renderTabFooter() {
    if (!selectedAnimal || !visibleTabs.length || !detailTab) return null;
    const idx = visibleTabs.indexOf(detailTab);
    if (idx === -1) return null;
    const last = idx === visibleTabs.length - 1;
    return (
      <div className="action-row">
        <button className="primary-btn" onClick={last ? submitTabs : goToNextTab}>
          {last ? "Submit" : "Save and Next"}
        </button>
      </div>
    );
  }

  function patchSelected(fn) {
    setAnimals((prev) => {
      let updatedSelected = null;
      const mapped = prev.map((a) => {
        if (a.id !== selectedId) return a;
        updatedSelected = fn(withDefaults(a));
        return updatedSelected;
      });
      const nextMapped = updatedSelected?.category === "Female" ? syncDamCalvesInHerd(mapped, updatedSelected) : mapped;
      return normalizeLineageAcrossHerd(nextMapped);
    });
  }
  function updateFemalePedigree(key, value) { patchSelected((a) => ({ ...a, femaleDetails: { ...a.femaleDetails, pedigree: { ...a.femaleDetails.pedigree, [key]: value } } })); }
  function updateMalePedigree(key, value) { patchSelected((a) => ({ ...a, maleDetails: { ...a.maleDetails, pedigree: { ...a.maleDetails.pedigree, [key]: value } } })); }
  function updateSelectedRepro(key, value) { patchSelected((a) => { const currentParity = a.femaleDetails.selectedReproParity; const parities = a.femaleDetails.reproductionParities.map((p) => p.parityNo === currentParity ? { ...p, [key]: value, expectedCalvingDate: key === "conceptionDate" ? addDays(value, 310) : p.expectedCalvingDate } : p); return { ...a, femaleDetails: { ...a.femaleDetails, reproductionParities: parities } }; }); }
  function addAIRecord() { patchSelected((a) => { const currentParity = a.femaleDetails.selectedReproParity; const parities = a.femaleDetails.reproductionParities.map((p) => p.parityNo === currentParity ? { ...p, aiRecords: [...p.aiRecords, { aiDate: "", aiBullNo: "", aiSetNo: "", result: "Pending" }] } : p); return { ...a, femaleDetails: { ...a.femaleDetails, reproductionParities: parities } }; }); }
  function removeAIRecord() { patchSelected((a) => { const currentParity = a.femaleDetails.selectedReproParity; const parities = a.femaleDetails.reproductionParities.map((p) => p.parityNo === currentParity ? { ...p, aiRecords: p.aiRecords.slice(0, -1) } : p); return { ...a, femaleDetails: { ...a.femaleDetails, reproductionParities: parities } }; }); }
  function updateAIRecord(idx, key, value) { patchSelected((a) => { const currentParity = a.femaleDetails.selectedReproParity; const parities = a.femaleDetails.reproductionParities.map((p) => { if (p.parityNo !== currentParity) return p; const nextRecords = p.aiRecords.map((r, i) => i === idx ? { ...r, [key]: value } : r); const conceivedRecord = nextRecords.find((r) => r.result === "Conceived"); return { ...p, aiRecords: nextRecords, conceptionDate: conceivedRecord ? conceivedRecord.aiDate || p.conceptionDate : p.conceptionDate, expectedCalvingDate: conceivedRecord ? addDays(conceivedRecord.aiDate || "", 310) : p.expectedCalvingDate }; }); return { ...a, femaleDetails: { ...a.femaleDetails, reproductionParities: parities } }; }); }
  function incrementReproParity() { patchSelected((a) => { const current = Number(a.femaleDetails.selectedReproParity || 0) + 1, next = String(current); const exists = a.femaleDetails.reproductionParities.some((p) => p.parityNo === next); return { ...a, femaleDetails: { ...a.femaleDetails, selectedReproParity: next, reproductionParities: exists ? a.femaleDetails.reproductionParities : [...a.femaleDetails.reproductionParities, makeReproParity(next)] } }; }); }
  function decrementReproParity() { patchSelected((a) => ({ ...a, femaleDetails: { ...a.femaleDetails, selectedReproParity: String(Math.max(0, Number(a.femaleDetails.selectedReproParity || 0) - 1)) } })); }
  function updateCalvingParity(idx, key, value) {
    patchSelected((a) => {
      const next = a.femaleDetails.calvingParities.map((p, i) => {
        if (i !== idx) return p;
        const row = { ...p, [key]: value };
        if (key === "calvingDate" || key === "calvingOutcome") row.calfSire = row.calvingOutcome === "Normal calving" ? (getCalfSireForCalving(a, row.parityNo) || row.calfSire || "") : "";
        if (key === "calvingOutcome" && value !== "Normal calving") { row.calfSex = ""; row.calfTag = ""; row.calfSire = ""; }
        return row;
      });
      let productionLactations = a.femaleDetails.productionLactations.map((l) => {
        const calving = next.find((c) => c.parityNo === l.parityNo); return { ...l, calvingDate: calving?.calvingDate || l.calvingDate || "" };
      });
      productionLactations = productionLactations.map((l) => {
        if (l.entryMode === "Friday Records" && !(l.fridayRecords || []).length) { const autoDate = firstRecordableFriday(l.calvingDate); if (autoDate) return { ...l, fridayRecords: [makeFridayRecord(autoDate)] }; }
        return l;
      });
      return { ...a, preCalvingLifecycle: getFemaleLifecycle(a), femaleDetails: { ...a.femaleDetails, calvingParities: next, productionLactations } };
    });
  }
  function addCalvingParity() { patchSelected((a) => { const nextNo = String(a.femaleDetails.calvingParities.length + 1); const prodExists = a.femaleDetails.productionLactations.some((l) => l.parityNo === nextNo); return { ...a, femaleDetails: { ...a.femaleDetails, calvingParities: [...a.femaleDetails.calvingParities, makeCalvingParity(nextNo)], productionLactations: prodExists ? a.femaleDetails.productionLactations : [...a.femaleDetails.productionLactations, makeProductionLactation(nextNo)] } }; }); }
  function removeCalvingParity() { patchSelected((a) => ({ ...a, femaleDetails: { ...a.femaleDetails, calvingParities: a.femaleDetails.calvingParities.length > 1 ? a.femaleDetails.calvingParities.slice(0, -1) : a.femaleDetails.calvingParities } })); }
  function selectProductionParity(value) { patchSelected((a) => ({ ...a, femaleDetails: { ...a.femaleDetails, selectedProductionParity: String(value) } })); }
  function updateSelectedLactation(key, value) { patchSelected((a) => { const currentParity = a.femaleDetails.selectedProductionParity; let lactations = a.femaleDetails.productionLactations.map((l) => l.parityNo === currentParity ? { ...l, [key]: value } : l); if (key === "entryMode" && value === "Friday Records") lactations = lactations.map((l) => { if (l.parityNo !== currentParity) return l; if ((l.fridayRecords || []).length) return l; const autoDate = firstRecordableFriday(l.calvingDate); return autoDate ? { ...l, fridayRecords: [makeFridayRecord(autoDate)] } : l; }); return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } }; }); }
  function updateManualSummary(key, value) { patchSelected((a) => { const currentParity = a.femaleDetails.selectedProductionParity; const lactations = a.femaleDetails.productionLactations.map((l) => l.parityNo === currentParity ? { ...l, manualSummary: { ...l.manualSummary, [key]: value } } : l); return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } }; }); }
  function addFridayRecord() { patchSelected((a) => { const currentParity = a.femaleDetails.selectedProductionParity; const lactations = a.femaleDetails.productionLactations.map((l) => l.parityNo === currentParity ? { ...l, fridayRecords: [...l.fridayRecords, makeFridayRecord(getNextFridayRecordDate(l))] } : l); return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } }; }); }
  function removeFridayRecord() { patchSelected((a) => { const currentParity = a.femaleDetails.selectedProductionParity; const lactations = a.femaleDetails.productionLactations.map((l) => l.parityNo === currentParity ? { ...l, fridayRecords: l.fridayRecords.slice(0, -1) } : l); return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } }; }); }
  function updateFridayRecord(idx, key, value) { patchSelected((a) => { const currentParity = a.femaleDetails.selectedProductionParity; const lactations = a.femaleDetails.productionLactations.map((l) => { if (l.parityNo !== currentParity) return l; const records = l.fridayRecords.map((r, i) => i === idx ? recalcFridayRecord({ ...r, [key]: value }) : r); return { ...l, fridayRecords: records }; }); return { ...a, femaleDetails: { ...a.femaleDetails, productionLactations: lactations } }; }); }
  function addHealthRecord(section, scope = "female") {
    const makers = { bodyWeightRecords: makeBodyWeightRecord, dewormingRecords: makeDewormingRecord, vaccinationRecords: makeVaccinationRecord, treatmentRecords: makeTreatmentRecord };
    patchSelected((a) => {
      const key = scope === "male" ? "maleDetails" : "femaleDetails";
      return { ...a, [key]: { ...a[key], health: { ...a[key].health, [section]: [...a[key].health[section], makers[section]()] } } };
    });
  }
  function removeHealthRecord(section, scope = "female") {
    patchSelected((a) => {
      const key = scope === "male" ? "maleDetails" : "femaleDetails";
      return { ...a, [key]: { ...a[key], health: { ...a[key].health, [section]: a[key].health[section].length > 1 ? a[key].health[section].slice(0, -1) : a[key].health[section] } } };
    });
  }
  function updateHealthRecord(section, idx, field, value, scope = "female") {
    patchSelected((a) => {
      const key = scope === "male" ? "maleDetails" : "femaleDetails";
      return { ...a, [key]: { ...a[key], health: { ...a[key].health, [section]: a[key].health[section].map((r, i) => i === idx ? { ...r, [field]: value } : r) } } };
    });
  }
  function updateHistoryMeta(key, value) { patchSelected((a) => ({ ...a, femaleDetails: { ...a.femaleDetails, historyMeta: { ...a.femaleDetails.historyMeta, [key]: value } } })); }
  function updateMaleHistoryMeta(key, value) { patchSelected((a) => ({ ...a, maleDetails: { ...a.maleDetails, historyMeta: { ...a.maleDetails.historyMeta, [key]: value } } })); }
  function addDiseaseTest() { patchSelected((a) => ({ ...a, maleDetails: { ...a.maleDetails, diseaseTests: [...a.maleDetails.diseaseTests, makeDiseaseTestRecord()] } })); }
  function removeDiseaseTest() { patchSelected((a) => ({ ...a, maleDetails: { ...a.maleDetails, diseaseTests: a.maleDetails.diseaseTests.length > 1 ? a.maleDetails.diseaseTests.slice(0, -1) : a.maleDetails.diseaseTests } })); }
  function updateDiseaseTest(idx, key, value) { patchSelected((a) => ({ ...a, maleDetails: { ...a.maleDetails, diseaseTests: a.maleDetails.diseaseTests.map((r, i) => i === idx ? { ...r, [key]: value } : r) } })); }

  const currentList = herdView === "current" ? filteredCurrentAnimals : filteredArchivedAnimals;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-xl">
          <div className="topbar">
            <div>
              <div className="title">Buffalo Animal Data Recording App</div>
              <div className="subtitle">Phase 2.6 patch · breeding bull tabs added</div>
            </div>
            <div className="action-row">
              <button className="primary-btn" onClick={() => setShowAdd(true)}>Add Animal</button>
              {selectedAnimal?.category === "Female" && <button className="secondary-btn" onClick={() => exportHistoryPdf(selectedAnimal)}>Export History PDF</button>}
              {selectedAnimal?.category === "Male" && selectedAnimal?.isBreedingBull === "Yes" && <button className="secondary-btn" onClick={() => exportBullHistoryPdf(selectedAnimal, femaleProgenies, maleProgenies)}>Export Bull PDF</button>}
            </div>
          </div>
        </div>

        {validationMessage && (
          <Section title="Validation / Status">
            <div className="validation-box">{validationMessage}</div>
          </Section>
        )}


        <Section title="Phase 4.1 Command Center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleImportBackup}
          />
          <div className="helper-note">Storage mode: {storageMode}</div>
          <div className="action-row">
            <button className="secondary-btn" onClick={exportFullBackup}>Export Full Backup</button>
            <button className="secondary-btn" onClick={triggerImportBackup}>Import Backup</button>
            <button className="secondary-btn" onClick={async () => {
              if (!isSupabaseConfigured || !supabase) {
                setValidationMessage("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
                return;
              }
              try {
                await saveAnimalsToSupabase(animals);
                setValidationMessage("Data synced to Supabase.");
              } catch (error) {
                setValidationMessage(`Supabase sync failed. ${error?.message || ""}`.trim());
              }
            }}>Sync Now</button>
            <button className="secondary-btn" onClick={() => setMobilePanelOpen((v) => !v)}>
              {mobilePanelOpen ? "Hide Mobile Panel" : "Show Mobile Panel"}
            </button>
            <button className="secondary-btn danger-btn" onClick={resetLocalData}>Reset Local Data</button>
          </div>
          {mobilePanelOpen && (
            <div className="mobile-panel">
              <div className="helper-note">Quick mobile actions for small screens.</div>
              <div className="action-row">
                <button className="primary-btn" onClick={() => setShowAdd(true)}>Add Animal</button>
                <button className="secondary-btn" onClick={jumpToAnimalBySearch}>Jump to Animal</button>
                <button className="secondary-btn" onClick={() => setHerdView("current")}>Current Herd</button>
                <button className="secondary-btn" onClick={() => setHerdView("archive")}>Archive</button>
              </div>
            </div>
          )}
        </Section>


        <Section title="Database Setup Guide">
          <div className="helper-note">
            To enable shared storage, create a Supabase project, then add environment variables
            <strong> VITE_SUPABASE_URL </strong> and <strong> VITE_SUPABASE_ANON_KEY </strong> in Vercel.
            Create a table named <strong>buffalo_app_records</strong> with columns:
            <strong> id </strong> (text, primary key) and <strong> payload </strong> (jsonb).
          </div>
          <div className="helper-note">
            Recommended SQL:
            <code className="inline-code"> create table buffalo_app_records (id text primary key, payload jsonb not null default '[]'::jsonb); </code>
          </div>
        </Section>

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
                  {newAnimal.isBreedingBull === "Yes" && <TextField label="Included as breeding in which set (Roman numerals only)" value={newAnimal.breedingSet || ""} onChange={(v) => setNewAnimal((s) => ({ ...s, breedingSet: normalizeRomanInput(v) }))} />}
                  {newAnimal.isBreedingBull === "Yes" && <div className="helper-note">Example: XI, XII, XIII</div>}
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
              <button className="secondary-btn" onClick={() => { setShowAdd(false); setValidationMessage(""); setNewAnimal({ ...emptyAnimal }); }}>Cancel</button>
            </div>
          </Section>
        )}

        {isEditingAnimal && (
          <Section title="Edit Animal">
            <Grid>
              <SelectField label="Breed" value={editAnimalForm.breed} onChange={(v) => setEditAnimalForm((s) => ({ ...s, breed: v }))} options={BREEDS} />
              <TextField label="Tag No." value={editAnimalForm.tagNo} onChange={(v) => setEditAnimalForm((s) => ({ ...s, tagNo: v }))} />
              <TextField label="Date of birth" value={editAnimalForm.dob} onChange={(v) => setEditAnimalForm((s) => ({ ...s, dob: normalizeDisplayDate(v) }))} placeholder="dd/mm/yyyy" />
              <SelectField label="Category" value={editAnimalForm.category} onChange={(v) => setEditAnimalForm((s) => normalizeAnimalFormData({ ...s, category: v }))} options={SEX_OPTIONS} />
              <TextField label="Identification mark" value={editAnimalForm.identificationMark} onChange={(v) => setEditAnimalForm((s) => ({ ...s, identificationMark: v }))} />
              <SelectField label="Status" value={editAnimalForm.status} onChange={(v) => setEditAnimalForm((s) => normalizeAnimalFormData({ ...s, status: v }))} options={STATUS_OPTIONS} />
              {editAnimalForm.category === "Male" && (
                <>
                  <SelectField label="Selected for breeding" value={editAnimalForm.isBreedingBull || "No"} onChange={(v) => setEditAnimalForm((s) => normalizeAnimalFormData({ ...s, isBreedingBull: v }))} options={["No", "Yes"]} />
                  {editAnimalForm.isBreedingBull === "Yes" && <TextField label="Included as breeding in which set (Roman numerals only)" value={editAnimalForm.breedingSet || ""} onChange={(v) => setEditAnimalForm((s) => ({ ...s, breedingSet: normalizeRomanInput(v) }))} />}
                  {editAnimalForm.isBreedingBull === "Yes" && <div className="helper-note">Example: XI, XII, XIII</div>}
                </>
              )}
              {editAnimalForm.status !== "Active (present in herd)" && (
                <>
                  <TextField label="Date of Death / Culling" value={editAnimalForm.exitDate || ""} onChange={(v) => setEditAnimalForm((s) => ({ ...s, exitDate: normalizeDisplayDate(v) }))} placeholder="dd/mm/yyyy" />
                  <TextAreaField label="Reason of Death / Culling" value={editAnimalForm.exitReason || ""} onChange={(v) => setEditAnimalForm((s) => ({ ...s, exitReason: v }))} />
                </>
              )}
            </Grid>
            <div className="action-row">
              <button className="primary-btn" onClick={saveEditedAnimal}>Save Animal</button>
              <button className="secondary-btn" onClick={() => { setIsEditingAnimal(false); setValidationMessage(""); }}>Cancel</button>
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

        <Section title="Dashboard">
          <div className="stats-grid">
            <StatCard title="Current Herd" value={activeAnimals.length} />
            <StatCard title="Archived" value={dashboardData.archivedCount} />
            <StatCard title="Breeding Bulls" value={dashboardData.breedingBulls.length} />
            <StatCard title="Pregnant Females" value={dashboardData.pregnantFemales} />
            <StatCard title="Dead" value={normalizedAnimals.filter((a) => a.status === "Dead").length} />
            <StatCard title="Culled" value={normalizedAnimals.filter((a) => a.status === "Culled").length} />
            <StatCard title="Milk Animals" value={dashboardData.femaleAnimals.filter((a) => getFemaleLifecycle(a) === "Milk").length} />
            <StatCard title="Dry Animals" value={dashboardData.femaleAnimals.filter((a) => getFemaleLifecycle(a) === "Dry").length} />
          </div>
        </Section>

        <div className="main-grid">
          <Section title="Herd Registry">
            <TextField label="Search" value={search} onChange={setSearch} />
            <div className="action-row">
              <button className="secondary-btn" onClick={jumpToAnimalBySearch}>Jump to Animal</button>
              <button className={herdView === "current" ? "primary-btn" : "secondary-btn"} onClick={() => setHerdView("current")}>Current Herd</button>
              <button className={herdView === "archive" ? "primary-btn" : "secondary-btn"} onClick={() => setHerdView("archive")}>Archive</button>
            </div>
            {herdView === "archive" && (
              <div className="action-row">
                <SelectField label="Archive filter" value={archiveFilter} onChange={setArchiveFilter} options={["All", "Dead", "Culled", "Female", "Male"]} />
              </div>
            )}
            <div className="list-wrap">
              {currentList.length === 0 && <div className="empty-note">No animals found.</div>}
              {currentList.map((animal) => (
                <button key={animal.id} className={`animal-card ${selectedId === animal.id ? "selected" : ""}`} onClick={() => { setSelectedId(animal.id); setValidationMessage(""); setDetailTab(animal.category === "Female" ? "pedigree" : animal.isBreedingBull === "Yes" ? "pedigree" : ""); }}>
                  <div className="animal-title">{animal.tagNo}</div>
                  <div className="animal-sub">{animal.breed} · {animal.category === "Female" ? getFemaleLifecycle(animal) : animal.isBreedingBull === "Yes" ? `Breeding Bull (${animal.breedingSet || "Set blank"})` : "Male"}</div>
                </button>
              ))}
            </div>
          </Section>

          <div className="right-stack">
            <Section title="Selected Animal Preview">
              {selectedAnimal && <div className="action-row"><button className="secondary-btn" onClick={openEditAnimal}>Edit Animal</button></div>}
              {!selectedAnimal && <div className="empty-note">No animal selected.</div>}
              {selectedAnimal && currentAnimalSummary && (
                <div className="stats-grid slim-stats">
                  {currentAnimalSummary.cards.map(([title, value]) => <StatCard key={title} title={title} value={value} />)}
                </div>
              )}
              {selectedAnimal && (
                <div className="preview-grid">
                  <div><strong>Tag No.:</strong> {selectedAnimal.tagNo}</div>
                  <div><strong>Breed:</strong> {selectedAnimal.breed}</div>
                  <div><strong>DOB:</strong> {selectedAnimal.dob || "—"}</div>
                  <div><strong>Sex:</strong> {selectedAnimal.category}</div>
                  <div><strong>Status:</strong> {selectedAnimal.status}</div>
                  <div><strong>Identification Mark:</strong> {selectedAnimal.identificationMark || "—"}</div>
                  {selectedAnimal.category === "Female" && <div><strong>Current category:</strong> {getFemaleLifecycle(selectedAnimal)}</div>}
                  {selectedAnimal.category === "Female" && <div><strong>Linked sire bull:</strong> {getLinkedBullByAnimal(selectedAnimal, normalizedAnimals)?.tagNo || selectedAnimal.linkedSireTag || "—"}</div>}
                  {selectedAnimal.category === "Male" && <div><strong>Breeding bull:</strong> {selectedAnimal.isBreedingBull === "Yes" ? `Yes (${selectedAnimal.breedingSet || "Set blank"})` : "No"}</div>}
                  {selectedAnimal.category === "Male" && selectedAnimal.isBreedingBull === "Yes" && <div><strong>Linked progenies:</strong> {femaleProgenies.length + maleProgenies.length}</div>}
                </div>
              )}
            </Section>

            {selectedAnimal && selectedAnimal.category === "Female" && (
              <Section title="Female Tabs">
                <div className="tab-row">
                  {visibleTabs.map((tab) => <button key={tab} className={detailTab === tab ? "primary-btn tab-btn" : "secondary-btn tab-btn"} onClick={() => setDetailTab(tab)}>{tab}</button>)}
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
                    <div className="parity-head"><div className="parity-controls"><button className="secondary-btn square-btn" onClick={decrementReproParity}>−</button><div className="parity-box">{selectedAnimal.femaleDetails.selectedReproParity}</div><button className="secondary-btn square-btn" onClick={incrementReproParity}>+</button></div></div>
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
                    <div className="action-row"><button className="primary-btn" onClick={addAIRecord}>Add AI record</button><button className="secondary-btn" onClick={removeAIRecord}>Remove last AI</button></div>
                  </div>
                )}

                {detailTab === "calving" && (
                  <div className="stack-gap">
                    {selectedAnimal.femaleDetails.calvingParities.map((cp, idx) => {
                      const metrics = computeCalvingMetrics(selectedAnimal, cp.parityNo);
                      return (
                        <div key={`calving-${idx}`} className="mini-card">
                          <div className="subsection-label">Calving parity {cp.parityNo}</div>
                          <Grid>
                            <TextField label="Calving date" value={cp.calvingDate || ""} onChange={(v) => updateCalvingParity(idx, "calvingDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" />
                            <SelectField label="Calf sex" value={cp.calfSex || ""} onChange={(v) => updateCalvingParity(idx, "calfSex", v)} options={["", ...SEX_OPTIONS]} />
                            <TextField label="Calf tag no. (auto-adds calf)" value={cp.calfTag || ""} onChange={(v) => updateCalvingParity(idx, "calfTag", v)} />
                            <TextField label="Calf sire (auto)" value={cp.calfSire || getCalfSireForCalving(selectedAnimal, cp.parityNo) || ""} onChange={(v) => updateCalvingParity(idx, "calfSire", v)} />
                            <SelectField label="Calving outcome" value={cp.calvingOutcome || "Normal calving"} onChange={(v) => updateCalvingParity(idx, "calvingOutcome", v)} options={CALVING_OUTCOMES} />
                            <TextAreaField label="Remarks" value={cp.remarks || ""} onChange={(v) => updateCalvingParity(idx, "remarks", v)} />
                            <TextField label="GP (days)" value={metrics.gestationPeriod} onChange={() => {}} readOnly />
                            <TextField label="AFC (days)" value={metrics.afc} onChange={() => {}} readOnly />
                            <TextField label="SP (days)" value={metrics.servicePeriod} onChange={() => {}} readOnly />
                            <TextField label="CI (days)" value={metrics.calvingInterval} onChange={() => {}} readOnly />
                          </Grid>
                        </div>
                      );
                    })}
                    <div className="action-row"><button className="primary-btn" onClick={addCalvingParity}>Add calving parity</button><button className="secondary-btn" onClick={removeCalvingParity}>Remove last parity</button></div>
                  </div>
                )}

                {detailTab === "production" && selectedLactation && (
                  <div className="stack-gap">
                    <Grid>
                      <SelectField label="Select parity" value={selectedAnimal.femaleDetails.selectedProductionParity} onChange={selectProductionParity} options={selectedAnimal.femaleDetails.productionLactations.map((l) => l.parityNo)} />
                      <TextField label="Calving date" value={selectedLactation.calvingDate || ""} onChange={() => {}} readOnly />
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
                        <div className="subsection-label">First recordable Friday: {firstRecordableFriday(selectedLactation.calvingDate || "") || "—"}</div>
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
                        <div className="action-row"><button className="primary-btn" onClick={addFridayRecord}>Add Friday record</button><button className="secondary-btn" onClick={removeFridayRecord}>Remove last Friday</button></div>
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

                {detailTab === "health" && (
                  <div className="stack-gap">
                    <div className="tab-row">{HEALTH_SUBTABS.map((tab) => <button key={tab.id} className={healthSubTab === tab.id ? "primary-btn tab-btn" : "secondary-btn tab-btn"} onClick={() => setHealthSubTab(tab.id)}>{tab.label}</button>)}</div>
                    {healthSubTab === "bodyWeight" && <div className="stack-gap">{selectedAnimal.femaleDetails.health.bodyWeightRecords.map((r, idx) => <div key={`bw-${idx}`} className="mini-card"><Grid><TextField label="Recording date" value={r.recordDate || ""} onChange={(v) => updateHealthRecord("bodyWeightRecords", idx, "recordDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" /><TextField label="Body weight" value={r.bodyWeight || ""} onChange={(v) => updateHealthRecord("bodyWeightRecords", idx, "bodyWeight", v)} /></Grid></div>)}<div className="action-row"><button className="primary-btn" onClick={() => addHealthRecord("bodyWeightRecords")}>+</button><button className="secondary-btn" onClick={() => removeHealthRecord("bodyWeightRecords")}>−</button></div></div>}
                    {healthSubTab === "deworming" && <div className="stack-gap">{selectedAnimal.femaleDetails.health.dewormingRecords.map((r, idx) => <div key={`dw-${idx}`} className="mini-card"><Grid><TextField label="Deworming date" value={r.dewormingDate || ""} onChange={(v) => updateHealthRecord("dewormingRecords", idx, "dewormingDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" /><TextField label="Anthelmintic used" value={r.anthelminticUsed || ""} onChange={(v) => updateHealthRecord("dewormingRecords", idx, "anthelminticUsed", v)} /></Grid></div>)}<div className="action-row"><button className="primary-btn" onClick={() => addHealthRecord("dewormingRecords")}>+</button><button className="secondary-btn" onClick={() => removeHealthRecord("dewormingRecords")}>−</button></div></div>}
                    {healthSubTab === "vaccination" && <div className="stack-gap">{selectedAnimal.femaleDetails.health.vaccinationRecords.map((r, idx) => <div key={`vx-${idx}`} className="mini-card"><Grid><TextField label="Vaccination date" value={r.vaccinationDate || ""} onChange={(v) => updateHealthRecord("vaccinationRecords", idx, "vaccinationDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" /><TextField label="Vaccine used" value={r.vaccineUsed || ""} onChange={(v) => updateHealthRecord("vaccinationRecords", idx, "vaccineUsed", v)} /></Grid></div>)}<div className="action-row"><button className="primary-btn" onClick={() => addHealthRecord("vaccinationRecords")}>+</button><button className="secondary-btn" onClick={() => removeHealthRecord("vaccinationRecords")}>−</button></div></div>}
                    {healthSubTab === "treatment" && <div className="stack-gap">{selectedAnimal.femaleDetails.health.treatmentRecords.map((r, idx) => <div key={`tx-${idx}`} className="mini-card"><Grid><TextField label="Treatment date" value={r.treatmentDate || ""} onChange={(v) => updateHealthRecord("treatmentRecords", idx, "treatmentDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" /><TextField label="Diagnosis" value={r.diagnosis || ""} onChange={(v) => updateHealthRecord("treatmentRecords", idx, "diagnosis", v)} /><TextAreaField label="Treatment given" value={r.treatmentGiven || ""} onChange={(v) => updateHealthRecord("treatmentRecords", idx, "treatmentGiven", v)} /></Grid></div>)}<div className="action-row"><button className="primary-btn" onClick={() => addHealthRecord("treatmentRecords")}>+</button><button className="secondary-btn" onClick={() => removeHealthRecord("treatmentRecords")}>−</button></div></div>}
                  </div>
                )}

                {detailTab === "history" && (
                  <div className="stack-gap">
                    <Grid>
                      <TextField label="Reason for culling" value={selectedAnimal.femaleDetails.historyMeta.reasonForCulling || ""} onChange={(v) => updateHistoryMeta("reasonForCulling", v)} />
                      <TextField label="Book value" value={selectedAnimal.femaleDetails.historyMeta.bookValue || ""} onChange={(v) => updateHistoryMeta("bookValue", v)} />
                      <TextField label="AFC (days)" value={computeCalvingMetrics(selectedAnimal, 1).afc || ""} onChange={() => {}} readOnly />
                    </Grid>
                    <div className="stats-grid slim-stats">
                      <StatCard title="Linked progenies" value={femaleProgenies.length + maleProgenies.length} />
                      <StatCard title="Archived linked progenies" value={[...femaleProgenies, ...maleProgenies].filter((a) => isArchivedAnimal(a)).length} />
                      <StatCard title="Daughters in milk" value={femaleProgenies.filter((a) => getFemaleLifecycle(a) === "Milk").length} />
                      <StatCard title="Lineage mode" value={"ID + text"} />
                    </div>
                    <div className="stats-grid slim-stats">
                      <StatCard title="Female progenies" value={femaleProgenies.length} />
                      <StatCard title="Male progenies" value={maleProgenies.length} />
                      <StatCard title="Archived linked" value={[...femaleProgenies, ...maleProgenies].filter((a) => isArchivedAnimal(a)).length} />
                      <StatCard title="Daughters in milk" value={femaleProgenies.filter((a) => getFemaleLifecycle(a) === "Milk").length} />
                    </div>
                    <div className="print-note">This layout is optimized for on-screen review and browser printing.</div>
                    <div className="print-note">This layout is optimized for on-screen review and browser printing.</div>
                    <div className="table-wrap">
                      <table className="history-table">
                        <thead><tr><th>Parity</th><th>Date Calved</th><th>GP</th><th>Sex of Calf</th><th>Tag No. of Calf</th><th>Date of 1st AI</th><th>Date of Conception</th><th>Bull No./Set No.</th><th>Total AI</th><th>Dry Date</th><th>TLMY</th><th>SLMY</th><th>LL</th><th>PY</th><th>SP</th><th>CI</th><th>Fat %</th><th>SNF %</th><th>TS %</th></tr></thead>
                        <tbody>{historyRows.map((row, idx) => <tr key={`hist-${idx}`}><td>{row.parity}</td><td>{row.dateCalved}</td><td>{row.gp}</td><td>{row.sexOfCalf}</td><td>{row.calfTag}</td><td>{row.firstAI}</td><td>{row.conceptionDate}</td><td>{row.bullNo}</td><td>{row.totalAI}</td><td>{row.dryDate}</td><td>{row.tlmy}</td><td>{row.slmy}</td><td>{row.ll}</td><td>{row.py}</td><td>{row.sp}</td><td>{row.ci}</td><td>{row.fat}</td><td>{row.snf}</td><td>{row.ts}</td></tr>)}</tbody>
                      </table>
                    </div>
                    <div className="action-row"><button className="primary-btn" onClick={() => exportHistoryPdf(selectedAnimal)}>Export History PDF</button></div>
                  </div>
                )}
                {renderTabFooter()}
              </Section>
            )}

            {selectedAnimal && selectedAnimal.category === "Male" && selectedAnimal.isBreedingBull === "Yes" && (
              <Section title="Breeding Bull Tabs">
                <div className="tab-row">
                  {visibleTabs.map((tab) => <button key={tab} className={detailTab === tab ? "primary-btn tab-btn" : "secondary-btn tab-btn"} onClick={() => setDetailTab(tab)}>{tab}</button>)}
                </div>

                {detailTab === "pedigree" && (
                  <Grid>
                    <TextField label="Sire" value={selectedAnimal.maleDetails.pedigree.sire} onChange={(v) => updateMalePedigree("sire", v)} />
                    <TextField label="Dam" value={selectedAnimal.maleDetails.pedigree.dam} onChange={(v) => updateMalePedigree("dam", v)} />
                    <TextField label="Sire's sire" value={selectedAnimal.maleDetails.pedigree.sireSire} onChange={(v) => updateMalePedigree("sireSire", v)} />
                    <TextField label="Sire's dam" value={selectedAnimal.maleDetails.pedigree.sireDam} onChange={(v) => updateMalePedigree("sireDam", v)} />
                    <TextField label="Dam's sire" value={selectedAnimal.maleDetails.pedigree.damSire} onChange={(v) => updateMalePedigree("damSire", v)} />
                    <TextField label="Dam's dam" value={selectedAnimal.maleDetails.pedigree.damDam} onChange={(v) => updateMalePedigree("damDam", v)} />
                  </Grid>
                )}

                {detailTab === "disease testing" && (
                  <div className="stack-gap">
                    {selectedAnimal.maleDetails.diseaseTests.map((r, idx) => (
                      <div key={`dt-${idx}`} className="mini-card">
                        <Grid>
                          <TextField label="Test date" value={r.testDate || ""} onChange={(v) => updateDiseaseTest(idx, "testDate", normalizeDisplayDate(v))} placeholder="dd/mm/yyyy" />
                          <TextField label="Test name" value={r.testName || ""} onChange={(v) => updateDiseaseTest(idx, "testName", v)} />
                          <TextField label="Result" value={r.result || ""} onChange={(v) => updateDiseaseTest(idx, "result", v)} />
                          <TextAreaField label="Remarks" value={r.remarks || ""} onChange={(v) => updateDiseaseTest(idx, "remarks", v)} />
                        </Grid>
                      </div>
                    ))}
                    <div className="action-row"><button className="primary-btn" onClick={addDiseaseTest}>+</button><button className="secondary-btn" onClick={removeDiseaseTest}>−</button></div>
                  </div>
                )}

                {detailTab === "progenies born" && (
                  <div className="stack-gap">
                    <div className="tab-row">
                      {MALE_PROGENY_SUBTABS.map((tab) => <button key={tab.id} className={maleProgenySubTab === tab.id ? "primary-btn tab-btn" : "secondary-btn tab-btn"} onClick={() => setMaleProgenySubTab(tab.id)}>{tab.label}</button>)}
                    </div>
                    {maleProgenySubTab === "female" && (
                      <div className="table-wrap">
                        <table className="history-table">
                          <thead><tr><th>Tag No.</th><th>DOB</th><th>Breed</th><th>Current category</th><th>Dam</th></tr></thead>
                          <tbody>{femaleProgenies.map((a) => <tr key={a.id}><td>{a.tagNo}</td><td>{a.dob || ""}</td><td>{a.breed}</td><td>{getFemaleLifecycle(a)}</td><td>{a.femaleDetails?.pedigree?.dam || ""}</td></tr>)}</tbody>
                        </table>
                        {femaleProgenies.length === 0 && <div className="empty-note">No female progenies linked yet.</div>}
                        {femaleProgenies.length > 0 && <div className="helper-note">Future records now prefer explicit sire linkage over text-only matching. Lineage is now more stable for future edits and exports.</div>}
                      </div>
                    )}
                    {maleProgenySubTab === "male" && (
                      <div className="table-wrap">
                        <table className="history-table">
                          <thead><tr><th>Tag No.</th><th>DOB</th><th>Breed</th><th>Status</th><th>Dam</th></tr></thead>
                          <tbody>{maleProgenies.map((a) => <tr key={a.id}><td>{a.tagNo}</td><td>{a.dob || ""}</td><td>{a.breed}</td><td>{a.status}</td><td>{a.maleDetails?.pedigree?.dam || ""}</td></tr>)}</tbody>
                        </table>
                        {maleProgenies.length === 0 && <div className="empty-note">No male progenies linked yet.</div>}
                        {maleProgenies.length > 0 && <div className="helper-note">Future records now prefer explicit sire linkage over text-only matching. Lineage is now more stable for future edits and exports.</div>}
                      </div>
                    )}
                  </div>
                )}

                {detailTab === "performance of daughters" && (
                  <div className="stack-gap">
                    <div className="tab-row">
                      {DAUGHTER_PERF_SUBTABS.map((tab) => <button key={tab.id} className={daughterPerfSubTab === tab.id ? "primary-btn tab-btn" : "secondary-btn tab-btn"} onClick={() => setDaughterPerfSubTab(tab.id)}>{tab.label}</button>)}
                    </div>
                    {daughterPerfSubTab === "production" && (
                      <div className="stack-gap">
                        <div className="stats-grid slim-stats">
                          <StatCard title="Daughters" value={daughterProductionSummary.daughterCount} />
                          <StatCard title="Lactations" value={daughterProductionSummary.lactationCount} />
                          <StatCard title="Avg TLMY" value={daughterProductionSummary.averageTLMY} />
                          <StatCard title="Max Peak Yield" value={daughterProductionSummary.maxPeak} />
                        </div>
                        <div className="table-wrap">
                        <table className="history-table">
                          <thead><tr><th>Daughter Tag</th><th>Current category</th><th>Parity/Lactation</th><th>TLMY</th><th>SLMY</th><th>Peak yield</th></tr></thead>
                          <tbody>
                            {femaleProgenies.flatMap((a) => (a.femaleDetails?.productionLactations || []).map((l) => {
                              const m = computeProductionMetrics(l);
                              return <tr key={`${a.id}-${l.parityNo}`}><td>{a.tagNo}</td><td>{getFemaleLifecycle(a)}</td><td>{l.parityNo}</td><td>{m.totalLactationMilk}</td><td>{m.standardLactationMilk}</td><td>{m.peakYield}</td></tr>;
                            }))}
                          </tbody>
                        </table>
                        {femaleProgenies.length === 0 && <div className="empty-note">No daughters linked yet.</div>}
                      </div>
                      </div>
                    )}
                    {daughterPerfSubTab === "reproduction" && (
                      <div className="stack-gap">
                        <div className="stats-grid slim-stats">
                          <StatCard title="Daughters" value={daughterReproductionSummary.daughterCount} />
                          <StatCard title="Parities" value={daughterReproductionSummary.parityCount} />
                          <StatCard title="Conceived" value={daughterReproductionSummary.conceivedCount} />
                          <StatCard title="Avg services/parity" value={daughterReproductionSummary.avgServicesPerParity} />
                        </div>
                        <div className="table-wrap">
                        <table className="history-table">
                          <thead><tr><th>Daughter Tag</th><th>Current category</th><th>Parity</th><th>Conception date</th><th>Expected calving</th><th>Services</th></tr></thead>
                          <tbody>
                            {femaleProgenies.flatMap((a) => (a.femaleDetails?.reproductionParities || []).map((r) => <tr key={`${a.id}-rep-${r.parityNo}`}><td>{a.tagNo}</td><td>{getFemaleLifecycle(a)}</td><td>{r.parityNo}</td><td>{r.conceptionDate || ""}</td><td>{r.expectedCalvingDate || ""}</td><td>{(r.aiRecords || []).length}</td></tr>))}
                          </tbody>
                        </table>
                        {femaleProgenies.length === 0 && <div className="empty-note">No daughters linked yet.</div>}
                      </div>
                      </div>
                    )}
                  </div>
                )}

                {detailTab === "health" && (
                  <div className="stack-gap">
                    <div className="tab-row">
                      {HEALTH_SUBTABS.map((tab) => <button key={tab.id} className={healthSubTab === tab.id ? "primary-btn tab-btn" : "secondary-btn tab-btn"} onClick={() => setHealthSubTab(tab.id)}>{tab.label}</button>)}
                    </div>
                    {healthSubTab === "bodyWeight" && <div className="stack-gap">{selectedAnimal.maleDetails.health.bodyWeightRecords.map((r, idx) => <div key={`mbw-${idx}`} className="mini-card"><Grid><TextField label="Recording date" value={r.recordDate || ""} onChange={(v) => updateHealthRecord("bodyWeightRecords", idx, "recordDate", normalizeDisplayDate(v), "male")} placeholder="dd/mm/yyyy" /><TextField label="Body weight" value={r.bodyWeight || ""} onChange={(v) => updateHealthRecord("bodyWeightRecords", idx, "bodyWeight", v, "male")} /></Grid></div>)}<div className="action-row"><button className="primary-btn" onClick={() => addHealthRecord("bodyWeightRecords", "male")}>+</button><button className="secondary-btn" onClick={() => removeHealthRecord("bodyWeightRecords", "male")}>−</button></div></div>}
                    {healthSubTab === "deworming" && <div className="stack-gap">{selectedAnimal.maleDetails.health.dewormingRecords.map((r, idx) => <div key={`mdw-${idx}`} className="mini-card"><Grid><TextField label="Deworming date" value={r.dewormingDate || ""} onChange={(v) => updateHealthRecord("dewormingRecords", idx, "dewormingDate", normalizeDisplayDate(v), "male")} placeholder="dd/mm/yyyy" /><TextField label="Anthelmintic used" value={r.anthelminticUsed || ""} onChange={(v) => updateHealthRecord("dewormingRecords", idx, "anthelminticUsed", v, "male")} /></Grid></div>)}<div className="action-row"><button className="primary-btn" onClick={() => addHealthRecord("dewormingRecords", "male")}>+</button><button className="secondary-btn" onClick={() => removeHealthRecord("dewormingRecords", "male")}>−</button></div></div>}
                    {healthSubTab === "vaccination" && <div className="stack-gap">{selectedAnimal.maleDetails.health.vaccinationRecords.map((r, idx) => <div key={`mvx-${idx}`} className="mini-card"><Grid><TextField label="Vaccination date" value={r.vaccinationDate || ""} onChange={(v) => updateHealthRecord("vaccinationRecords", idx, "vaccinationDate", normalizeDisplayDate(v), "male")} placeholder="dd/mm/yyyy" /><TextField label="Vaccine used" value={r.vaccineUsed || ""} onChange={(v) => updateHealthRecord("vaccinationRecords", idx, "vaccineUsed", v, "male")} /></Grid></div>)}<div className="action-row"><button className="primary-btn" onClick={() => addHealthRecord("vaccinationRecords", "male")}>+</button><button className="secondary-btn" onClick={() => removeHealthRecord("vaccinationRecords", "male")}>−</button></div></div>}
                    {healthSubTab === "treatment" && <div className="stack-gap">{selectedAnimal.maleDetails.health.treatmentRecords.map((r, idx) => <div key={`mtx-${idx}`} className="mini-card"><Grid><TextField label="Treatment date" value={r.treatmentDate || ""} onChange={(v) => updateHealthRecord("treatmentRecords", idx, "treatmentDate", normalizeDisplayDate(v), "male")} placeholder="dd/mm/yyyy" /><TextField label="Diagnosis" value={r.diagnosis || ""} onChange={(v) => updateHealthRecord("treatmentRecords", idx, "diagnosis", v, "male")} /><TextAreaField label="Treatment given" value={r.treatmentGiven || ""} onChange={(v) => updateHealthRecord("treatmentRecords", idx, "treatmentGiven", v, "male")} /></Grid></div>)}<div className="action-row"><button className="primary-btn" onClick={() => addHealthRecord("treatmentRecords", "male")}>+</button><button className="secondary-btn" onClick={() => removeHealthRecord("treatmentRecords", "male")}>−</button></div></div>}
                  </div>
                )}

                {detailTab === "overall history sheet" && (
                  <div className="stack-gap">
                    <Grid>
                      <TextField label="Remarks" value={selectedAnimal.maleDetails.historyMeta.remarks || ""} onChange={(v) => updateMaleHistoryMeta("remarks", v)} />
                      <TextField label="Book value" value={selectedAnimal.maleDetails.historyMeta.bookValue || ""} onChange={(v) => updateMaleHistoryMeta("bookValue", v)} />
                      <TextField label="Breeding set" value={selectedAnimal.breedingSet || ""} onChange={() => {}} readOnly />
                    </Grid>
                    <div className="action-row"><button className="secondary-btn" onClick={() => exportBullHistoryPdf(selectedAnimal, femaleProgenies, maleProgenies)}>Export Bull PDF</button></div>
                    <div className="table-wrap">
                      <table className="history-table">
                        <thead><tr><th>Type</th><th>Count</th></tr></thead>
                        <tbody>
                          <tr><td>Female progenies</td><td>{femaleProgenies.length}</td></tr>
                          <tr><td>Male progenies</td><td>{maleProgenies.length}</td></tr>
                          <tr><td>Total daughters in milk</td><td>{femaleProgenies.filter((a) => getFemaleLifecycle(a) === "Milk").length}</td></tr>
                          <tr><td>Total archived progenies retained in lineage</td><td>{[...femaleProgenies, ...maleProgenies].filter((a) => isArchivedAnimal(a)).length}</td></tr>
                          <tr><td>Lineage continuity check</td><td>{(femaleProgenies.length + maleProgenies.length) > 0 ? "OK" : "No linked progenies yet"}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {renderTabFooter()}
              </Section>
            )}
          </div>
        </div>

        <div className="mobile-sticky-bar">
          <button className="primary-btn mobile-grow" onClick={() => setShowAdd(true)}>Add Animal</button>
          <button className="secondary-btn mobile-grow" onClick={jumpToAnimalBySearch}>Jump</button>
        </div>
      </div>
    </div>
  );
}
