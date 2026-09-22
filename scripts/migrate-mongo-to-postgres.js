#!/usr/bin/env node
/**
 * MongoDB (Mongoose)  ->  PostgreSQL (Prisma)  data migration
 * ===========================================================
 *
 * Covers: admins, question sets (legacy + batched), quizzes (single/multi-subject,
 * batch snapshots), quiz takers (incl. JAMB/parent/attendance-department fields),
 * quiz submissions, CBT submissions, game sessions, schedules, and attendance.
 *
 * Design
 * ------
 *  1. EXTRACT   Reads raw documents straight from MongoDB (no Mongoose models, so no
 *               hooks/validators/defaults run and nothing is written back).
 *  2. TRANSFORM Pure, in-memory. Flattens embedded arrays into child tables, converts
 *               ObjectIds -> deterministic UUIDs, applies the defaults Mongoose would
 *               have applied, validates every foreign key and unique constraint, and
 *               records anything it had to skip/alter in a report.
 *  3. LOAD      Inserts in FK-safe order inside ONE transaction (all-or-nothing).
 *  4. VERIFY    Compares row counts and score checksums.
 *
 * IDs are deterministic (UUIDv5 of "<kind>:<mongoId>"), so the same Mongo document
 * always maps to the same UUID and no lookup table is needed. Question ids are keyed
 * on the sub-document's own Mongo _id alone (not its parent set/batch) because that
 * _id is globally unique - this lets the same helper resolve a question whether it
 * lives in a legacy `questions[]` array or inside a `batches[]` entry.
 *
 * Usage
 * -----
 *   npm i mongoose @prisma/client dotenv
 *   node scripts/migrate-mongo-to-postgres.js --dry-run            # transform + report only (writes nothing to Postgres)
 *   node scripts/migrate-mongo-to-postgres.js                      # real run (target tables must be empty)
 *   node scripts/migrate-mongo-to-postgres.js --reset --yes        # TRUNCATE migrated tables first, then load
 *
 * Flags
 *   --dry-run     Extract + transform + write migration-report.json, then exit.
 *   --reset       TRUNCATE all migrated tables before loading (requires --yes).
 *   --yes         Confirm --reset.
 *   --force       Load even though the report contains "error" items (rows that were skipped).
 *   --no-tx       Don't wrap the load in one transaction (use if your host limits long transactions).
 *
 * Env
 *   MONGODB_URI (or MONGO_URI)    source database
 *   DIRECT_URL  (or DATABASE_URL) target database. DIRECT_URL is preferred: bulk loads should
 *                                 bypass PgBouncer / connection poolers.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ───────────────────────────── configuration ───────────────────────────── */

// Never change this after the first real run, or every generated UUID changes.
const ID_NAMESPACE = '3f6c1a52-7d4b-4e8a-9b1c-2a5d8e0f4c37';

// question_set_order / submission_question_set_order: is `position` 0- or 1-based in your app code?
const POSITION_BASE = 1;

const CHUNK_SIZE = 1000;

// Mongo collections this script migrates.
const MONGO_COLLECTIONS = [
  'admins',
  'questionsets',
  'quizzes',
  'quiztakers',
  'quizsubmissions',
  'cbtsubmissions',
  'gamesessions',
  'schedules',
  'attendancesessions',
  'attendancerecords',
];

// Prisma delegate name -> table name. Key order == FK-safe insert order.
const TABLES = {
  admin: 'admins',
  questionSet: 'question_sets',
  batch: 'question_set_batches',
  question: 'questions',
  quiz: 'quizzes',
  quizQuestionSet: 'quiz_question_sets',
  quizQuestion: 'quiz_questions',
  schedule: 'schedules',
  weeklyClassSession: 'weekly_class_sessions',
  scheduleOverride: 'schedule_overrides',
  quizTaker: 'quiz_takers',
  quizTakerQuestionSet: 'quiz_taker_question_sets',
  assignedQuiz: 'assigned_quizzes',
  questionSetOrder: 'question_set_order',
  questionSetProgress: 'question_set_progress',
  quizSubmission: 'quiz_submissions',
  submissionAnswer: 'submission_answers',
  questionSetSubmission: 'question_set_submissions',
  submissionQuestionSetOrder: 'submission_question_set_order',
  cbtSubmission: 'cbt_submissions',
  cbtQuestionSet: 'cbt_question_sets',
  cbtAnswer: 'cbt_answers',
  quizTakenHistory: 'quiz_taken_history',
  quizHistoryQuestionSet: 'quiz_history_question_sets',
  gameSession: 'game_sessions',
  gameUsedQuestion: 'game_used_questions',
  gameHistory: 'game_history',
  attendanceSession: 'attendance_sessions',
  attendanceWindowEvent: 'attendance_window_events',
  attendanceRecord: 'attendance_records',
};
const LOAD_ORDER = Object.keys(TABLES);

/* ───────────────────────────── deterministic ids ───────────────────────────── */

const NS_BYTES = Buffer.from(ID_NAMESPACE.replace(/-/g, ''), 'hex');

function uuid5(name) {
  const hash = crypto.createHash('sha1').update(NS_BYTES).update(String(name)).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const ID = {
  admin: (a) => uuid5(`admin:${a}`),
  questionSet: (qs) => uuid5(`questionSet:${qs}`),
  batch: (b) => uuid5(`batch:${b}`),
  // Keyed on the question's OWN Mongo _id only (globally unique), not its parent
  // set/batch - so the same helper resolves a question from any context
  // (legacy questions[], a batch's questions[], an answer, a game session, ...).
  question: (q) => uuid5(`question:${q}`),
  quiz: (q) => uuid5(`quiz:${q}`),
  quizQuestionSet: (quiz, qset) => uuid5(`quizQuestionSet:${quiz}:${qset}`),
  quizQuestion: (quiz, qq) => uuid5(`quizQuestion:${quiz}:${qq}`),
  quizTaker: (t) => uuid5(`quizTaker:${t}`),
  takerQuestionSet: (t, qs) => uuid5(`takerQuestionSet:${t}:${qs}`),
  assignedQuiz: (t, aq) => uuid5(`assignedQuiz:${t}:${aq}`),
  child: (parentUuid, kind, key) => uuid5(`${kind}:${parentUuid}:${key}`),
  submission: (s) => uuid5(`submission:${s}`),
  cbt: (c) => uuid5(`cbt:${c}`),
  game: (g) => uuid5(`game:${g}`),
  schedule: (s) => uuid5(`schedule:${s}`),
  attendanceSession: (s) => uuid5(`attendanceSession:${s}`),
  attendanceRecord: (r) => uuid5(`attendanceRecord:${r}`),
};

/* ───────────────────────────── report ───────────────────────────── */

class Report {
  constructor() {
    this.items = new Map();
  }
  add(severity, kind, msg) {
    let e = this.items.get(kind);
    if (!e) {
      e = { severity, count: 0, samples: [] };
      this.items.set(kind, e);
    }
    e.count++;
    if (severity === 'error') e.severity = 'error';
    if (e.samples.length < 25) e.samples.push(msg);
  }
  warn(kind, msg) {
    this.add('warn', kind, msg);
  }
  error(kind, msg) {
    this.add('error', kind, msg);
  }
  get errorKinds() {
    return [...this.items.entries()].filter(([, e]) => e.severity === 'error');
  }
  toJSON() {
    return Object.fromEntries(this.items);
  }
}

let R = new Report();

/* ───────────────────────────── value helpers ───────────────────────────── */

const JSON_NULL = Symbol('JSON_NULL'); // replaced by Prisma.JsonNull at load time
const has = (v) => v !== undefined && v !== null;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const stripNul = (s) => (typeof s === 'string' ? s.replace(/\u0000/g, '') : s); // Postgres rejects NUL bytes

function date(v, fallback = null) {
  if (!has(v)) return fallback;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function int(v, def = 0, label = '') {
  if (!has(v)) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    R.warn('non-numeric-value', `${label} ${String(v)}`);
    return def;
  }
  if (!Number.isInteger(n)) {
    R.warn('decimal-rounded-to-int', `${label} ${n}`);
    return Math.round(n);
  }
  return n;
}

// Mongoose typed phone numbers as `Number` (a double). A phone number with a country
// code (e.g. 2348012345678) overflows Postgres's 32-bit Int, so the Prisma columns are
// BigInt. Values are well within Number.MAX_SAFE_INTEGER, so no precision is lost.
function bigintOrNull(v, label = '') {
  if (!has(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    R.warn('non-numeric-value', `${label} ${String(v)}`);
    return null;
  }
  if (!Number.isInteger(n)) R.warn('decimal-rounded-to-int', `${label} ${n}`);
  return BigInt(Math.round(n));
}

function pct(given, score, total) {
  const g = Number(given);
  if (has(given) && Number.isFinite(g)) return Math.round(g * 100) / 100;
  return total > 0 ? Math.round((score / total) * 10000) / 100 : 0;
}

/** varchar(n): strip NULs, truncate (with a warning) if too long. Returns null for null/undefined. */
function vc(v, max, label = '') {
  if (!has(v)) return null;
  let s = stripNul(String(v));
  if (s.length > max) {
    R.warn('string-truncated', `${label} (${s.length} > ${max})`);
    s = s.slice(0, max);
  }
  return s;
}

/** Mixed/array/object -> plain JSON. null/undefined -> undefined (SQL NULL). */
function toJson(v) {
  if (!has(v)) return undefined;
  return JSON.parse(JSON.stringify(v, (k, val) => (typeof val === 'string' ? stripNul(val) : val)));
}

const STATUS_RANK = { pending: 0, 'in-progress': 1, completed: 2 };

/* ───────────────────────────── extract ───────────────────────────── */

async function loadMongo(uri) {
  const mongoose = require('mongoose');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const raw = {};
  for (const name of MONGO_COLLECTIONS) {
    raw[name] = await db.collection(name).find({}).toArray();
  }
  const all = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
  const unmigrated = [];
  for (const name of all.filter((n) => !MONGO_COLLECTIONS.includes(n))) {
    unmigrated.push({ collection: name, documents: await db.collection(name).countDocuments() });
  }
  await mongoose.disconnect();
  return { raw, unmigrated };
}

/* ───────────────────────────── transform ───────────────────────────── */

function transform(raw) {
  R = new Report();
  const out = {};
  for (const k of LOAD_ORDER) out[k] = [];

  // Sets of ids that WILL exist in Postgres (used to validate every foreign key)
  const ex = {
    admin: new Set(),
    questionSet: new Set(),
    question: new Set(),
    quiz: new Set(),
    quizQuestion: new Set(),
    quizTaker: new Set(),
    schedule: new Set(),
    attendanceSession: new Set(),
  };
  const setTitle = new Map(); // questionSet uuid -> title
  const questionPoints = new Map(); // question uuid -> points
  const qqByOriginal = new Map(); // `${quizMongo}|${setOrder}|${origQuestionMongo}` -> quizQuestion uuid
  const assignedBySubmission = new Map(); // mongo submission _id -> assigned_quizzes uuid
  const assignedByTakerQuiz = new Map(); // `${takerUuid}|${quizUuid}` -> assigned_quizzes uuid

  /* ---------- admins ---------- */
  const seenEmail = new Set();
  for (const a of raw.admins) {
    const email = vc(a.email && String(a.email).trim().toLowerCase(), 255, `admin ${a._id} email`);
    if (!email || !a.password) {
      R.error('admin-skipped', `${a._id}: missing email or password`);
      continue;
    }
    if (seenEmail.has(email)) {
      R.error('admin-skipped', `${a._id}: duplicate email ${email}`);
      continue;
    }
    seenEmail.add(email);
    const id = ID.admin(a._id);
    const createdAt = date(a.createdAt, new Date());
    out.admin.push({
      id,
      email,
      password: vc(a.password, 255), // already a bcrypt hash - do NOT hash again
      role: vc(a.role || 'admin', 50),
      createdAt,
      updatedAt: createdAt,
    });
    ex.admin.add(id);
  }
  const soleAdmin = ex.admin.size === 1 ? [...ex.admin][0] : null;
  const resolveAdmin = (ref, label) => {
    const id = has(ref) ? ID.admin(ref) : null;
    if (id && ex.admin.has(id)) return id;
    if (soleAdmin) {
      R.warn('creator-reassigned-to-only-admin', `${label}: createdBy ${ref} not found`);
      return soleAdmin;
    }
    return null;
  };
  // Nullable admin reference (SetNull FK) - no fallback, just verify existence.
  const optionalAdmin = (ref) => {
    if (!has(ref)) return null;
    const id = ID.admin(ref);
    return ex.admin.has(id) ? id : null;
  };

  /* ---------- question sets: batches[] (new) + legacy questions[] ---------- */
  for (const qs of raw.questionsets) {
    const qsId = ID.questionSet(qs._id);
    const createdById = resolveAdmin(qs.createdBy, `questionSet ${qs._id}`);
    if (!createdById) {
      R.error('questionSet-skipped', `${qs._id}: creator not found`);
      continue;
    }
    const createdAt = date(qs.createdAt, new Date());
    const updatedAt = date(qs.updatedAt, createdAt);
    const usesBatches = qs.usesBatches === true;

    if (usesBatches && (qs.questions || []).length > 0) {
      R.warn('legacy-questions-ignored', `set ${qs._id}: usesBatches=true but legacy questions[] still has ${qs.questions.length} item(s) - ignored, matching app behavior`);
    }

    let setTotalPoints = 0;
    let setQuestionCount = 0;

    const migrateQuestions = (list, batchId, createdAtForList) => {
      const sorted = list.map((q, i) => ({ q, i })).sort((a, b) => num(a.q.order, a.i + 1) - num(b.q.order, b.i + 1) || a.i - b.i);
      let maxOrder = sorted.reduce((m, { q, i }) => Math.max(m, Math.round(num(q.order, i + 1))), 0);
      const usedOrders = new Set();
      let batchPoints = 0;
      for (const { q, i } of sorted) {
        let order = Math.round(num(q.order, i + 1));
        if (usedOrders.has(order)) {
          order = ++maxOrder;
          R.warn('question-order-renumbered', `set ${qs._id}${batchId ? ' batch' : ''} question ${q._id}: duplicate order -> ${order}`);
        }
        usedOrders.add(order);
        const points = int(q.points, 1, `question ${q._id} points`);
        batchPoints += points;
        const qid = ID.question(q._id ?? `${qs._id}:${batchId ?? 'legacy'}:${i}`);
        out.question.push({
          id: qid,
          questionSetId: qsId,
          batchId,
          type: vc(q.type, 50),
          question: stripNul(String(q.question ?? '')),
          passage: stripNul(q.passage ?? ''),
          diagram: has(q.diagram) ? vc(q.diagram, 500) : null,
          diagramAlt: stripNul(q.diagramAlt ?? ''),
          options: toJson(q.options),
          correctAnswer: toJson(q.correctAnswer),
          points,
          orderNum: order,
          tags: [],
          addedDate: createdAtForList,
          isArchived: false,
          createdAt: createdAtForList,
          updatedAt,
        });
        ex.question.add(qid);
        questionPoints.set(qid, points);
      }
      return { count: sorted.length, points: batchPoints };
    };

    if (usesBatches) {
      const seenBatchNumbers = new Set();
      (qs.batches || []).forEach((b, bi) => {
        let batchNumber = int(b.batchNumber, bi + 1, `batch ${b._id} number`);
        if (seenBatchNumbers.has(batchNumber)) {
          R.warn('batch-number-renumbered', `set ${qs._id} batch ${b._id}: duplicate batchNumber -> reassigned`);
          batchNumber = Math.max(...seenBatchNumbers, batchNumber) + 1;
        }
        seenBatchNumbers.add(batchNumber);
        const batchId = ID.batch(b._id ?? `${qs._id}:${bi}`);
        const batchCreatedAt = date(b.createdAt, createdAt);
        const { count, points } = migrateQuestions(b.questions || [], batchId, batchCreatedAt);
        out.batch.push({
          id: batchId,
          questionSetId: qsId,
          batchNumber,
          name: vc(b.name, 255, `batch ${b._id} name`) ?? `Batch ${batchNumber}`,
          totalPoints: points,
          questionCount: count,
          isActive: b.isActive ?? true,
          createdAt: batchCreatedAt,
        });
        if (b.isActive ?? true) {
          setTotalPoints += points;
          setQuestionCount += count;
        }
      });
    } else {
      const { count, points } = migrateQuestions(qs.questions || [], null, createdAt);
      setTotalPoints = points;
      setQuestionCount = count;
    }

    out.questionSet.push({
      id: qsId,
      title: vc(qs.title, 255, `questionSet ${qs._id} title`) ?? '',
      usesBatches,
      totalPoints: setTotalPoints,
      questionCount: setQuestionCount,
      isActive: qs.isActive ?? true,
      createdById,
      createdAt,
      updatedAt,
    });
    ex.questionSet.add(qsId);
    setTitle.set(qsId, qs.title ?? '');
  }

  /* ---------- quizzes + quiz_question_sets + quiz_questions ---------- */
  for (const q of raw.quizzes) {
    const quizId = ID.quiz(q._id);
    const s = q.settings || {};
    const d = s.duration || {};
    const examType = s.examType === 'single-subject' ? 'single-subject' : 'multi-subject';
    const createdById = resolveAdmin(q.createdBy, `quiz ${q._id}`);
    if (!createdById) {
      R.error('quiz-skipped', `${q._id}: creator not found`);
      continue;
    }
    const createdAt = date(q.createdAt, new Date());
    const updatedAt = date(q.updatedAt, createdAt);

    const expectedSets = examType === 'single-subject' ? 1 : 4;
    if ((q.questionSets || []).length !== expectedSets) {
      R.warn('quiz-set-count-unexpected', `quiz ${q._id}: examType=${examType} expects ${expectedSets} question set(s), found ${(q.questionSets || []).length}`);
    }

    const seenOrders = new Set();
    const seenSets = new Set();
    let quizTotal = 0;
    const sets = [...(q.questionSets || [])].sort((a, b) => num(a.order, 99) - num(b.order, 99));

    sets.forEach((qset, si) => {
      const setUuid = has(qset.questionSetId) ? ID.questionSet(qset.questionSetId) : null;
      if (!setUuid || !ex.questionSet.has(setUuid)) {
        R.error('quiz-set-dropped', `quiz ${q._id}: question set ${qset.questionSetId} (order ${qset.order}) does not exist`);
        return;
      }
      if (seenSets.has(setUuid)) {
        R.error('quiz-set-dropped', `quiz ${q._id}: question set ${qset.questionSetId} used twice (unique(quiz_id, question_set_id))`);
        return;
      }
      let order = int(qset.order, si + 1, `quiz ${q._id} set order`);
      if (seenOrders.has(order)) {
        const free = [1, 2, 3, 4].find((o) => !seenOrders.has(o));
        if (!free) {
          R.error('quiz-set-dropped', `quiz ${q._id}: no free order slot for set ${qset.questionSetId}`);
          return;
        }
        R.warn('quiz-set-order-fixed', `quiz ${q._id}: duplicate order ${order} -> ${free}`);
        order = free;
      }
      seenSets.add(setUuid);
      seenOrders.add(order);

      const qsetUuid = ID.quizQuestionSet(q._id, qset._id ?? `idx${si}`);
      const qqs = (qset.questions || []).map((qq, i) => ({ qq, i }));
      qqs.sort((a, b) => num(a.qq.order, a.i + 1) - num(b.qq.order, b.i + 1) || a.i - b.i);

      let setTotal = 0;
      for (const { qq, i } of qqs) {
        const qqUuid = ID.quizQuestion(q._id, qq._id ?? `${si}:${i}`);
        let original = null;
        if (has(qq.originalQuestionId)) {
          const cand = ID.question(qq.originalQuestionId);
          if (ex.question.has(cand)) original = cand; // else: question was deleted from the bank -> NULL (FK is SET NULL)
          const key = `${q._id}|${order}|${qq.originalQuestionId}`;
          if (!qqByOriginal.has(key)) qqByOriginal.set(key, qqUuid);
        }
        const points = int(qq.points, 1, `quiz ${q._id} question points`);
        setTotal += points;
        out.quizQuestion.push({
          id: qqUuid,
          quizQuestionSetId: qsetUuid,
          originalQuestionId: original,
          type: vc(qq.type, 50),
          question: stripNul(String(qq.question ?? '')),
          passage: stripNul(qq.passage ?? ''),
          diagram: has(qq.diagram) ? vc(qq.diagram, 500) : null,
          diagramAlt: stripNul(qq.diagramAlt ?? ''),
          options: toJson(qq.options),
          correctAnswer: toJson(qq.correctAnswer),
          points,
          orderNum: int(qq.order, i + 1),
          createdAt,
        });
        ex.quizQuestion.add(qqUuid);
      }
      quizTotal += setTotal;
      out.quizQuestionSet.push({
        id: qsetUuid,
        quizId,
        questionSetId: setUuid,
        // Batch snapshot - informational only, no live FK (source batch may since have changed).
        batchNumber: has(qset.batchNumber) ? int(qset.batchNumber) : null,
        batchId: has(qset.batchId) ? ID.batch(qset.batchId) : null,
        batchName: vc(qset.batchName, 255),
        title: vc(qset.title ?? setTitle.get(setUuid) ?? '', 255) ?? '',
        orderNum: order,
        totalPoints: setTotal,
        createdAt,
      });
    });

    out.quiz.push({
      id: quizId,
      examType,
      title: vc(s.title, 255, `quiz ${q._id} title`) ?? '',
      coverImage: vc(s.coverImage, 500),
      isQuizChallenge: s.isQuizChallenge ?? false,
      isOpenQuiz: s.isOpenQuiz ?? false,
      description: has(s.description) ? stripNul(s.description) : null,
      instructions: has(s.instructions) ? stripNul(s.instructions) : null,
      durationHours: int(d.hours, 0),
      durationMinutes: int(d.minutes, 30),
      durationSeconds: int(d.seconds, 0),
      multipleAttempts: s.multipleAttempts ?? false,
      looseFocus: s.looseFocus ?? false,
      viewAnswer: s.viewAnswer ?? true,
      viewResults: s.viewResults ?? true,
      displayCalculator: s.displayCalculator ?? false,
      totalPoints: quizTotal,
      isActive: q.isActive ?? true,
      createdById,
      createdAt,
      updatedAt,
    });
    ex.quiz.add(quizId);
  }

  /* ---------- schedules (+ weekly classes, overrides) ---------- */
  const seenDept = new Set();
  for (const sch of raw.schedules) {
    const schId = ID.schedule(sch._id);
    const dept = vc(sch.department, 20, `schedule ${sch._id} department`);
    if (!dept) {
      R.error('schedule-skipped', `${sch._id}: missing department`);
      continue;
    }
    if (seenDept.has(dept)) {
      R.error('schedule-skipped', `${sch._id}: duplicate department ${dept} (unique constraint)`);
      continue;
    }
    const createdById = resolveAdmin(sch.createdBy, `schedule ${sch._id}`);
    if (!createdById) {
      R.error('schedule-skipped', `${sch._id}: creator not found`);
      continue;
    }
    seenDept.add(dept);
    const createdAt = date(sch.createdAt, new Date());
    out.schedule.push({
      id: schId,
      department: dept,
      createdById,
      isActive: sch.isActive ?? true,
      createdAt,
      updatedAt: date(sch.updatedAt, createdAt),
    });
    ex.schedule.add(schId);

    (sch.weeklySchedule || []).forEach((cs, i) => {
      const setUuid = has(cs.questionSet) ? ID.questionSet(cs.questionSet) : null;
      if (!setUuid || !ex.questionSet.has(setUuid)) {
        R.error('weekly-class-skipped', `schedule ${sch._id}: question set ${cs.questionSet} does not exist`);
        return;
      }
      out.weeklyClassSession.push({
        id: ID.child(schId, 'weeklyClass', cs._id ?? `idx${i}`),
        scheduleId: schId,
        dayOfWeek: int(cs.dayOfWeek, 0),
        dayName: vc(cs.dayName, 10) ?? '',
        questionSetId: setUuid,
        questionSetTitle: vc(cs.questionSetTitle ?? setTitle.get(setUuid) ?? '', 255) ?? '',
        startTime: vc(cs.startTime, 10) ?? '19:00',
        endTime: vc(cs.endTime, 10) ?? '21:00',
        isActive: cs.isActive ?? true,
      });
    });

    (sch.overrides || []).forEach((ov, i) => {
      const cs = ov.classSession || {};
      const setUuid = has(cs.questionSet) ? ID.questionSet(cs.questionSet) : null;
      if (!setUuid || !ex.questionSet.has(setUuid)) {
        R.error('schedule-override-skipped', `schedule ${sch._id}: override ${ov._id ?? i} question set ${cs.questionSet} does not exist`);
        return;
      }
      const overrideDate = date(ov.date);
      if (!overrideDate) {
        R.error('schedule-override-skipped', `schedule ${sch._id}: override ${ov._id ?? i} missing date`);
        return;
      }
      out.scheduleOverride.push({
        id: ID.child(schId, 'override', ov._id ?? `idx${i}`),
        scheduleId: schId,
        date: overrideDate,
        questionSetId: setUuid,
        questionSetTitle: vc(cs.questionSetTitle ?? setTitle.get(setUuid) ?? '', 255) ?? '',
        startTime: vc(cs.startTime, 10) ?? '19:00',
        endTime: vc(cs.endTime, 10) ?? '21:00',
        isActive: cs.isActive ?? true,
        reason: stripNul(ov.reason ?? ''),
      });
    });
  }

  /* ---------- quiz takers (+ combination, history, assigned quizzes) ---------- */
  const seenAccess = new Set();
  for (const t of raw.quiztakers) {
    const takerId = ID.quizTaker(t._id);
    const email = vc(t.email && String(t.email).trim().toLowerCase(), 255, `quizTaker ${t._id} email`);
    if (!email) {
      R.error('quizTaker-skipped', `${t._id}: no email`);
      continue;
    }
    const accessCode = has(t.accessCode) && String(t.accessCode).trim() !== '' ? String(t.accessCode).trim() : null;
    if (accessCode && accessCode.length > 9) {
      R.error('quizTaker-skipped', `${t._id}: accessCode longer than VarChar(9)`);
      continue;
    }
    if (accessCode && seenAccess.has(accessCode)) {
      R.error('quizTaker-skipped', `${t._id}: duplicate accessCode`);
      continue;
    }
    if (accessCode) seenAccess.add(accessCode);
    const accountType = t.accountType || 'premium';
    if (accountType === 'premium' && !accessCode) R.warn('premium-without-access-code', `${t._id}`);
    const createdAt = date(t.createdAt, new Date());

    out.quizTaker.push({
      id: takerId,
      accountType: vc(accountType, 20),
      name: vc(t.name, 255),
      phone: bigintOrNull(t.phone, `quizTaker ${t._id} phone`),
      firstJamb: t.firstJamb ?? true,
      lastJambScore: int(t.lastJambScore, 0),
      parentName: vc(t.parentName, 255),
      parentPhone: bigintOrNull(t.parentPhone, `quizTaker ${t._id} parentPhone`),
      department: vc(t.department, 20),
      course: vc(t.course, 255),
      email,
      accessCode,
      isActive: t.isActive ?? true,
      createdAt,
      updatedAt: createdAt,
    });
    ex.quizTaker.add(takerId);

    // questionSetCombination[] -> quiz_taker_question_sets (array ORDER is not stored by this table)
    const seenQs = new Set();
    for (const sid of t.questionSetCombination || []) {
      const sUuid = ID.questionSet(sid);
      if (!ex.questionSet.has(sUuid)) {
        R.warn('taker-question-set-missing', `taker ${t._id}: question set ${sid} does not exist`);
        continue;
      }
      if (seenQs.has(sUuid)) {
        R.warn('taker-question-set-duplicate', `taker ${t._id}: ${sid} listed twice`);
        continue;
      }
      seenQs.add(sUuid);
      out.quizTakerQuestionSet.push({
        id: ID.takerQuestionSet(t._id, sid),
        quizTakerId: takerId,
        questionSetId: sUuid,
        assignedAt: createdAt,
      });
    }

    // quizzesTaken[] -> quiz_taken_history (+ quiz_history_question_sets)
    (t.quizzesTaken || []).forEach((h, i) => {
      const hid = ID.child(takerId, 'history', h._id ?? `idx${i}`);
      const quizUuid = has(h.quizId) ? ID.quiz(h.quizId) : null;
      const score = int(h.score, 0, 'history score');
      const totalPoints = int(h.totalPoints, 0, 'history totalPoints');
      out.quizTakenHistory.push({
        id: hid,
        quizTakerId: takerId,
        quizId: quizUuid && ex.quiz.has(quizUuid) ? quizUuid : null,
        submissionId: null, // Mongo never stored this link
        examType: vc(h.examType, 20),
        score,
        totalPoints,
        percentage: pct(h.percentage, score, totalPoints),
        timeTaken: int(h.timeTaken, 0),
        completedAt: date(h.completedAt, createdAt),
      });
      (h.questionSets || []).forEach((qs, j) => {
        const sUuid = has(qs.questionSetId) ? ID.questionSet(qs.questionSetId) : null;
        out.quizHistoryQuestionSet.push({
          id: ID.child(hid, 'historyQs', j),
          quizHistoryId: hid,
          questionSetId: sUuid && ex.questionSet.has(sUuid) ? sUuid : null,
          title: vc(qs.title, 255),
        });
      });
    });

    // assignedQuizzes[] -> assigned_quizzes (+ question_set_order, question_set_progress)
    if (accountType === 'regular' && (t.assignedQuizzes || []).length) {
      R.warn('regular-taker-has-assigned-quizzes', `${t._id}`);
    }
    const kept = new Map(); // quizUuid -> { rank, id, aq, status }   (unique(quiz_taker_id, quiz_id))
    const links = []; // [mongoSubmissionId, quizUuid]
    (t.assignedQuizzes || []).forEach((aq, i) => {
      const quizUuid = has(aq.quizId) ? ID.quiz(aq.quizId) : null;
      if (!quizUuid || !ex.quiz.has(quizUuid)) {
        R.warn('assigned-quiz-skipped', `taker ${t._id}: quiz ${aq.quizId} does not exist`);
        return;
      }
      const status = aq.status || 'pending';
      const rank = STATUS_RANK[status] ?? 0;
      const rowId = ID.assignedQuiz(t._id, aq._id ?? `idx${i}`);
      if (has(aq.submissionId)) links.push([String(aq.submissionId), quizUuid]);
      const cur = kept.get(quizUuid);
      if (cur) {
        R.warn('assigned-quiz-duplicate', `taker ${t._id}: quiz ${aq.quizId} assigned twice, keeping most advanced`);
        if (rank < cur.rank) return;
      }
      kept.set(quizUuid, { rank, id: rowId, aq, status });
    });

    for (const [quizUuid, { id: rowId, aq, status }] of kept) {
      assignedByTakerQuiz.set(`${takerId}|${quizUuid}`, rowId);
      out.assignedQuiz.push({
        id: rowId,
        quizTakerId: takerId,
        quizId: quizUuid,
        status: vc(status, 20),
        currentQuestionSetOrder: has(aq.currentQuestionSetOrder) ? int(aq.currentQuestionSetOrder) : null,
        assignedAt: date(aq.assignedAt, createdAt),
        startedAt: date(aq.startedAt),
        completedAt: date(aq.completedAt),
      });
      (aq.selectedQuestionSetOrder || []).forEach((v, idx) => {
        out.questionSetOrder.push({
          id: ID.child(rowId, 'qsOrder', idx),
          assignedQuizId: rowId,
          position: idx + POSITION_BASE,
          orderValue: int(v),
        });
      });
      const progress = new Map();
      for (const p of aq.questionSetProgress || []) {
        const order = int(p.questionSetOrder);
        if (progress.has(order)) R.warn('progress-duplicate-order', `assigned quiz ${rowId} order ${order}`);
        progress.set(order, p);
      }
      for (const [order, p] of progress) {
        out.questionSetProgress.push({
          id: ID.child(rowId, 'qsProgress', order),
          assignedQuizId: rowId,
          questionSetOrder: order,
          selectedOrder: has(p.selectedOrder) ? int(p.selectedOrder) : null,
          status: vc(p.status || 'not-started', 20),
          score: int(p.score, 0, 'progress score'),
          totalPoints: int(p.totalPoints, 0, 'progress totalPoints'),
          startedAt: date(p.startedAt),
          completedAt: date(p.completedAt),
        });
      }
    }
    for (const [subId, quizUuid] of links) {
      const k = kept.get(quizUuid);
      if (k) assignedBySubmission.set(subId, k.id);
    }
  }

  /* ---------- quiz submissions (+ answers, per-set submissions, order used) ---------- */
  const inProgressKeys = new Set();
  for (const s of raw.quizsubmissions) {
    const sid = ID.submission(s._id);
    const quizUuid = has(s.quizId) ? ID.quiz(s.quizId) : null;
    const takerUuid = has(s.quizTakerId) ? ID.quizTaker(s.quizTakerId) : null;
    if (!quizUuid || !ex.quiz.has(quizUuid)) {
      R.error('submission-skipped', `${s._id}: quiz ${s.quizId} does not exist`);
      continue;
    }
    if (!takerUuid || !ex.quizTaker.has(takerUuid)) {
      R.error('submission-skipped', `${s._id}: quiz taker ${s.quizTakerId} does not exist`);
      continue;
    }
    const status = s.status || 'in-progress';
    if (status === 'in-progress') {
      const k = `${quizUuid}|${takerUuid}`;
      if (inProgressKeys.has(k)) R.error('duplicate-in-progress-submission', `${s._id}: quiz ${s.quizId}, taker ${s.quizTakerId}`);
      inProgressKeys.add(k);
    }
    const startedAt = date(s.startedAt, date(s.createdAt, new Date()));
    const submittedAt = date(s.submittedAt, startedAt);
    const createdAt = date(s.createdAt, startedAt);
    const score = int(s.score, 0, `submission ${s._id} score`);
    const totalPoints = int(s.totalPoints, 0, `submission ${s._id} totalPoints`);
    const gradedBy = optionalAdmin(s.gradedBy);

    out.quizSubmission.push({
      id: sid,
      quizId: quizUuid,
      quizTakerId: takerUuid,
      // Mongo stored the link on the assignment (assignedQuizzes[].submissionId); Prisma stores it on the submission.
      assignedQuizId: assignedBySubmission.get(String(s._id)) ?? assignedByTakerQuiz.get(`${takerUuid}|${quizUuid}`) ?? null,
      status: vc(status, 30),
      score,
      totalPoints,
      percentage: pct(s.percentage, score, totalPoints),
      timeTaken: int(s.timeTaken, 0),
      feedback: has(s.feedback) ? stripNul(s.feedback) : null,
      gradedById: gradedBy,
      gradedAt: date(s.gradedAt),
      startedAt,
      submittedAt,
      createdAt,
      updatedAt: date(s.updatedAt, createdAt),
    });

    (s.answers || []).forEach((a, i) => {
      let qqUuid = has(a.questionId) ? ID.quizQuestion(s.quizId, a.questionId) : null;
      if (!qqUuid || !ex.quizQuestion.has(qqUuid)) {
        // answers may have been stored against the ORIGINAL question id instead of the quiz-question id
        qqUuid = qqByOriginal.get(`${s.quizId}|${a.questionSetOrder}|${a.questionId}`) ?? null;
      }
      if (!qqUuid) {
        R.error('answer-skipped', `submission ${s._id}: question ${a.questionId} not found in quiz ${s.quizId}`);
        return;
      }
      out.submissionAnswer.push({
        id: ID.child(sid, 'answer', i),
        submissionId: sid,
        quizQuestionId: qqUuid,
        questionSetOrder: int(a.questionSetOrder, 1),
        questionType: vc(a.questionType, 50),
        answer: toJson(a.answer),
        isCorrect: has(a.isCorrect) ? Boolean(a.isCorrect) : null,
        pointsAwarded: int(a.pointsAwarded, 0, 'answer pointsAwarded'),
        pointsPossible: int(a.pointsPossible, 0, 'answer pointsPossible'),
        createdAt,
      });
    });

    // The Mongoose "duplicate question set submission" hook does `return new Error(...)`, which does NOT abort a save,
    // so duplicates may exist in your data. Postgres enforces unique(quiz_submission_id, question_set_order).
    const perSet = new Map();
    for (const q of s.questionSetSubmissions || []) {
      const order = int(q.questionSetOrder, 0);
      const prev = perSet.get(order);
      if (prev) {
        R.warn('duplicate-question-set-submission', `submission ${s._id} order ${order}: keeping the latest`);
        if (date(prev.submittedAt, 0) > date(q.submittedAt, 0)) continue;
      }
      perSet.set(order, q);
    }
    for (const [order, q] of perSet) {
      const qScore = int(q.score, 0, 'set score');
      const qTotal = int(q.totalPoints, 0, 'set totalPoints');
      out.questionSetSubmission.push({
        id: ID.child(sid, 'qsSubmission', order),
        quizSubmissionId: sid,
        questionSetOrder: order,
        orderAnswered: has(q.orderAnswered) ? int(q.orderAnswered) : null,
        score: qScore,
        totalPoints: qTotal,
        percentage: pct(q.percentage, qScore, qTotal),
        submittedAt: date(q.submittedAt, submittedAt),
      });
    }

    (s.questionSetOrderUsed || []).forEach((v, idx) => {
      out.submissionQuestionSetOrder.push({
        id: ID.child(sid, 'orderUsed', idx),
        quizSubmissionId: sid,
        position: idx + POSITION_BASE,
        orderValue: int(v),
      });
    });
  }

  /* ---------- CBT submissions ---------- */
  for (const c of raw.cbtsubmissions) {
    const cid = ID.cbt(c._id);
    const takerUuid = has(c.quizTakerId) ? ID.quizTaker(c.quizTakerId) : null;
    if (!takerUuid || !ex.quizTaker.has(takerUuid)) {
      R.error('cbt-submission-skipped', `${c._id}: quiz taker ${c.quizTakerId} does not exist`);
      continue;
    }
    const startedAt = date(c.startedAt, date(c.createdAt, new Date()));
    const createdAt = date(c.createdAt, startedAt);
    const cScore = int(c.score, 0, `cbt ${c._id} score`);
    const cTotal = int(c.totalPoints, 0, `cbt ${c._id} totalPoints`);
    out.cbtSubmission.push({
      id: cid,
      quizTakerId: takerUuid,
      score: cScore,
      totalPoints: cTotal,
      percentage: pct(c.percentage, cScore, cTotal),
      timeTaken: int(c.timeTaken, 0),
      startedAt,
      submittedAt: date(c.submittedAt),
      createdAt,
      updatedAt: date(c.updatedAt, createdAt),
    });

    (c.questionSets || []).forEach((qs, i) => {
      const sUuid = has(qs.questionSetId) ? ID.questionSet(qs.questionSetId) : null;
      if (!sUuid || !ex.questionSet.has(sUuid)) {
        R.error('cbt-question-set-skipped', `cbt ${c._id}: question set ${qs.questionSetId} does not exist`);
        return;
      }
      out.cbtQuestionSet.push({
        id: ID.child(cid, 'cbtQs', qs._id ?? `idx${i}`),
        cbtSubmissionId: cid,
        questionSetId: sUuid,
        title: vc(qs.title ?? setTitle.get(sUuid) ?? '', 255) ?? '',
        orderNum: int(qs.order, i + 1),
      });
    });

    (c.answers || []).forEach((a, i) => {
      const qUuid = has(a.questionId) ? ID.question(a.questionId) : null;
      if (has(a.questionId) && (!qUuid || !ex.question.has(qUuid))) {
        R.warn('cbt-answer-question-missing', `cbt ${c._id}: question ${a.questionId} deleted; question_id set to NULL`);
      }
      const sUuid = has(a.questionSetId) ? ID.questionSet(a.questionSetId) : null;
      const resolvedQ = qUuid && ex.question.has(qUuid) ? qUuid : null;
      out.cbtAnswer.push({
        id: ID.child(cid, 'cbtAnswer', a._id ?? `idx${i}`),
        cbtSubmissionId: cid,
        questionId: resolvedQ,
        questionSetId: sUuid && ex.questionSet.has(sUuid) ? sUuid : null,
        answer: toJson(a.answer),
        isCorrect: has(a.isCorrect) ? Boolean(a.isCorrect) : null,
        pointsAwarded: int(a.pointsAwarded, 0, 'cbt pointsAwarded'),
        pointsPossible: has(a.pointsPossible) ? int(a.pointsPossible) : questionPoints.get(resolvedQ) ?? 0,
        createdAt,
      });
    });
  }

  /* ---------- game sessions ---------- */
  for (const g of raw.gamesessions) {
    const gid = ID.game(g._id);
    const userUuid = has(g.userId) ? ID.quizTaker(g.userId) : null;
    const setUuid = has(g.questionSetId) ? ID.questionSet(g.questionSetId) : null;
    if (!userUuid || !ex.quizTaker.has(userUuid)) {
      R.error('game-session-skipped', `${g._id}: user ${g.userId} does not exist`);
      continue;
    }
    if (!setUuid || !ex.questionSet.has(setUuid)) {
      R.error('game-session-skipped', `${g._id}: question set ${g.questionSetId} does not exist`);
      continue;
    }
    const startedAt = date(g.startedAt, date(g.createdAt, new Date()));
    const createdAt = date(g.createdAt, startedAt);
    out.gameSession.push({
      id: gid,
      userId: userUuid,
      gameType: vc(g.gameType || 'scholars-wager', 50),
      questionSetId: setUuid,
      subject: vc(g.subject ?? setTitle.get(setUuid) ?? '', 255) ?? '',
      currentScore: int(g.currentScore, 100),
      goalScore: int(g.goalScore, 1000),
      questionsAnswered: int(g.questionsAnswered, 0),
      correctAnswers: int(g.correctAnswers, 0),
      status: vc(g.status || 'active', 20),
      duration: has(g.duration) ? int(g.duration) : null,
      startedAt,
      completedAt: date(g.completedAt),
      createdAt,
      updatedAt: date(g.updatedAt, createdAt),
    });

    const usedSeen = new Set();
    for (const qid of g.usedQuestionIds || []) {
      const qUuid = ID.question(qid);
      if (!ex.question.has(qUuid)) {
        R.warn('game-used-question-missing', `game ${g._id}: question ${qid} no longer exists`);
        continue;
      }
      if (usedSeen.has(qUuid)) continue;
      usedSeen.add(qUuid);
      out.gameUsedQuestion.push({ id: ID.child(gid, 'usedQ', qUuid), gameSessionId: gid, questionId: qUuid });
    }

    (g.history || []).forEach((h, i) => {
      if (!has(h.questionId)) {
        R.error('game-history-skipped', `game ${g._id} history[${i}]: no questionId`);
        return;
      }
      const qUuid = ID.question(h.questionId); // no FK on this column, so history survives question deletion
      const pointsChange = int(h.pointsChange, 0);
      out.gameHistory.push({
        id: ID.child(gid, 'gameHistory', i),
        gameSessionId: gid,
        questionId: qUuid,
        question: stripNul(String(h.question ?? '')),
        selectedAnswer: vc(h.selectedAnswer ?? '', 500, `game ${g._id} selectedAnswer`) ?? '',
        correctAnswer: has(h.correctAnswer) ? toJson(h.correctAnswer) : JSON_NULL,
        wager: int(h.wager, 5),
        isCorrect: has(h.isCorrect) ? Boolean(h.isCorrect) : pointsChange > 0,
        pointsChange,
        timestamp: date(h.timestamp, createdAt),
      });
    });
  }

  /* ---------- attendance sessions (+ window history) ---------- */
  for (const s of raw.attendancesessions) {
    const sid = ID.attendanceSession(s._id);
    const setUuid = has(s.questionSet) ? ID.questionSet(s.questionSet) : null;
    if (!setUuid || !ex.questionSet.has(setUuid)) {
      R.error('attendance-session-skipped', `${s._id}: question set ${s.questionSet} does not exist`);
      continue;
    }
    const createdById = resolveAdmin(s.createdBy, `attendanceSession ${s._id}`);
    if (!createdById) {
      R.error('attendance-session-skipped', `${s._id}: creator not found`);
      continue;
    }
    const sessionDate = date(s.date);
    if (!sessionDate) {
      R.error('attendance-session-skipped', `${s._id}: missing date`);
      continue;
    }
    const w = s.attendanceWindow || {};
    const createdAt = date(s.createdAt, new Date());
    out.attendanceSession.push({
      id: sid,
      department: vc(s.department, 20, `attendanceSession ${s._id} department`) ?? '',
      questionSetId: setUuid,
      questionSetTitle: vc(s.questionSetTitle ?? setTitle.get(setUuid) ?? '', 255) ?? '',
      date: sessionDate,
      scheduledStartTime: vc(s.scheduledStartTime, 10) ?? '',
      scheduledEndTime: vc(s.scheduledEndTime, 10) ?? '',
      windowIsOpen: w.isOpen ?? false,
      windowOpenedAt: date(w.openedAt),
      windowClosedAt: date(w.closedAt),
      windowOpenedById: optionalAdmin(w.openedBy),
      windowClosedById: optionalAdmin(w.closedBy),
      windowDurationMinutes: int(w.durationMinutes, 30),
      windowBufferMinutes: int(w.bufferMinutes, 15),
      status: vc(s.status || 'scheduled', 20),
      totalStudents: int(s.totalStudents, 0),
      presentCount: int(s.presentCount, 0),
      absentCount: int(s.absentCount, 0),
      createdById,
      createdAt,
      updatedAt: date(s.updatedAt, createdAt),
    });
    ex.attendanceSession.add(sid);

    (s.windowHistory || []).forEach((e, i) => {
      out.attendanceWindowEvent.push({
        id: ID.child(sid, 'windowEvent', e._id ?? `idx${i}`),
        sessionId: sid,
        action: vc(e.action, 10) ?? '',
        timestamp: date(e.timestamp, createdAt),
        adminId: optionalAdmin(e.admin),
      });
    });
  }

  /* ---------- attendance records ---------- */
  const seenSessionStudent = new Set();
  for (const r of raw.attendancerecords) {
    const rid = ID.attendanceRecord(r._id);
    const sessionUuid = has(r.session) ? ID.attendanceSession(r.session) : null;
    if (!sessionUuid || !ex.attendanceSession.has(sessionUuid)) {
      R.error('attendance-record-skipped', `${r._id}: session ${r.session} does not exist`);
      continue;
    }
    const studentUuid = has(r.student) ? ID.quizTaker(r.student) : null;
    if (!studentUuid || !ex.quizTaker.has(studentUuid)) {
      R.error('attendance-record-skipped', `${r._id}: student ${r.student} does not exist`);
      continue;
    }
    const key = `${sessionUuid}|${studentUuid}`;
    if (seenSessionStudent.has(key)) {
      R.error('attendance-record-skipped', `${r._id}: duplicate (session, student) pair`);
      continue;
    }
    seenSessionStudent.add(key);
    const createdAt = date(r.createdAt, new Date());
    out.attendanceRecord.push({
      id: rid,
      sessionId: sessionUuid,
      studentId: studentUuid,
      studentName: vc(r.studentName, 255, `attendanceRecord ${r._id} studentName`) ?? '',
      studentEmail: vc(r.studentEmail, 255, `attendanceRecord ${r._id} studentEmail`) ?? '',
      department: vc(r.department, 20) ?? '',
      status: vc(r.status || 'absent', 10),
      markedBy: vc(r.markedBy, 10) ?? '',
      adminId: optionalAdmin(r.admin),
      markedAt: date(r.markedAt, createdAt),
      isLate: r.isLate ?? false,
      minutesLate: int(r.minutesLate, 0),
      notes: stripNul(r.notes ?? ''),
      createdAt,
    });
  }

  return { out, report: R };
}

/* ───────────────────────────── load + verify ───────────────────────────── */

const chunks = (arr, n) => {
  const res = [];
  for (let i = 0; i < arr.length; i += n) res.push(arr.slice(i, i + n));
  return res;
};

function prepareRow(row, Prisma) {
  const r = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === JSON_NULL) r[k] = Prisma.JsonNull; // required Json column holding JSON null
    else if (v !== undefined) r[k] = v; // undefined => omit => SQL NULL / column default
  }
  return r;
}

async function load(prisma, Prisma, out, { reset, noTx }) {
  if (reset) {
    const list = Object.values(TABLES).map((t) => `"${t}"`).join(', ');
    console.log('Truncating migrated tables...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  } else {
    for (const key of LOAD_ORDER) {
      if ((await prisma[key].count()) > 0) {
        throw new Error(`Table "${TABLES[key]}" is not empty. Re-run with --reset --yes to wipe the migrated tables first.`);
      }
    }
  }

  const work = async (db) => {
    for (const key of LOAD_ORDER) {
      const rows = out[key];
      let done = 0;
      for (const part of chunks(rows, CHUNK_SIZE)) {
        await db[key].createMany({ data: part.map((r) => prepareRow(r, Prisma)) });
        done += part.length;
        process.stdout.write(`\r  ${TABLES[key].padEnd(32)} ${done}/${rows.length}`);
      }
      process.stdout.write(`\r  ${TABLES[key].padEnd(32)} ${rows.length}/${rows.length}\n`);
    }
  };

  if (noTx) await work(prisma);
  else await prisma.$transaction(work, { maxWait: 60000, timeout: 30 * 60 * 1000 });
}

async function verify(prisma, out) {
  const rows = [];
  let bad = 0;
  for (const key of LOAD_ORDER) {
    const actual = await prisma[key].count();
    const ok = actual === out[key].length;
    if (!ok) bad++;
    rows.push({ table: TABLES[key], expected: out[key].length, actual, ok: ok ? 'OK' : 'MISMATCH' });
  }
  console.table(rows);

  const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
  const checks = [
    ['quiz_submissions.score', (await prisma.quizSubmission.aggregate({ _sum: { score: true } }))._sum.score ?? 0, sum(out.quizSubmission, (r) => r.score)],
    ['cbt_submissions.score', (await prisma.cbtSubmission.aggregate({ _sum: { score: true } }))._sum.score ?? 0, sum(out.cbtSubmission, (r) => r.score)],
    ['questions.points', (await prisma.question.aggregate({ _sum: { points: true } }))._sum.points ?? 0, sum(out.question, (r) => r.points)],
    ['game_sessions.current_score', (await prisma.gameSession.aggregate({ _sum: { currentScore: true } }))._sum.currentScore ?? 0, sum(out.gameSession, (r) => r.currentScore)],
    ['attendance_records.present', (await prisma.attendanceRecord.count({ where: { status: 'present' } })), out.attendanceRecord.filter((r) => r.status === 'present').length],
  ];
  for (const [name, actual, expected] of checks) {
    const ok = actual === expected;
    if (!ok) bad++;
    console.log(`  checksum ${name.padEnd(30)} db=${actual} expected=${expected} ${ok ? 'OK' : 'MISMATCH'}`);
  }
  return bad === 0;
}

/* ───────────────────────────── main ───────────────────────────── */

async function main() {
  const args = new Set(process.argv.slice(2));
  const dry = args.has('--dry-run');
  try {
    require('dotenv').config();
  } catch (_) {
    /* dotenv optional */
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('Set MONGODB_URI (or MONGO_URI).');
  const pgUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!dry && !pgUrl) throw new Error('Set DIRECT_URL (or DATABASE_URL).');
  if (args.has('--reset') && !args.has('--yes') && !dry) throw new Error('--reset TRUNCATES the target tables. Add --yes to confirm.');

  console.log('Reading MongoDB...');
  const { raw, unmigrated } = await loadMongo(mongoUri);

  console.log('Transforming...');
  const { out, report } = transform(raw);

  const summary = MONGO_COLLECTIONS.map((c) => ({ mongo_collection: c, documents: raw[c].length }));
  console.table(summary);
  console.table(LOAD_ORDER.map((k) => ({ table: TABLES[k], rows_to_insert: out[k].length })));

  const reportPath = path.resolve(process.cwd(), 'migration-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), notMigratedCollections: unmigrated, issues: report.toJSON() }, null, 2));
  console.log(`\nReport written to ${reportPath}`);

  if (unmigrated.length) {
    console.warn('\nCollections with NO migration mapping (left untouched in MongoDB):');
    console.table(unmigrated);
  }
  if (report.items.size) {
    console.log('\nIssues found:');
    console.table([...report.items.entries()].map(([kind, e]) => ({ kind, severity: e.severity, count: e.count, example: e.samples[0] })));
  }

  if (dry) {
    console.log('\nDry run complete - nothing was written to PostgreSQL.');
    return;
  }
  if (report.errorKinds.length && !args.has('--force')) {
    console.error('\nAborting: the report contains "error" items (rows that would be skipped). Review migration-report.json, fix the data or the schema, or re-run with --force to accept the losses.');
    process.exitCode = 1;
    return;
  }

  const { PrismaClient, Prisma } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: pgUrl } } });
  try {
    let host = '';
    try {
      host = new URL(pgUrl).host;
    } catch (_) {}
    console.log(`\nLoading into PostgreSQL ${host}...`);
    await load(prisma, Prisma, out, { reset: args.has('--reset'), noTx: args.has('--no-tx') });
    console.log('\nVerifying...');
    const ok = await verify(prisma, out);
    console.log(ok ? '\nMigration verified.' : '\nVerification found mismatches - investigate before switching traffic.');
    console.log(
      '\nNext: add the partial unique index via a custom migration (prisma migrate dev --create-only):\n' +
        "  CREATE UNIQUE INDEX idx_unique_in_progress_submission ON quiz_submissions(quiz_id, quiz_taker_id) WHERE status = 'in-progress';"
    );
    if (!ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { transform, uuid5, ID, TABLES, LOAD_ORDER };

if (require.main === module) {
  main().catch((err) => {
    console.error('\nMigration failed:', err);
    process.exit(1);
  });
}
