const express = require("express");
const router = express.Router();
const { verifyAdmin } = require("../middleware/auth");
const prisma = require("../utils/database");

const OPTIONAL_STRING_FIELDS = {
  staff: ["role", "course", "bio", "imageUrl"],
  testimonial: ["score", "course", "school", "imageUrl", "videoUrl", "videoDuration"],
  contact: ["email", "phone", "whatsapp", "website", "youtube", "address"],
};

const STRING_LIMITS = {
  name: 255,
  role: 255,
  course: 255,
  studentName: 255,
  imageUrl: 500,
  videoUrl: 500,
  videoDuration: 20,
  email: 255,
  phone: 50,
  whatsapp: 50,
  website: 500,
  youtube: 500,
  address: 500,
  page: 50,
  key: 100,
  label: 255,
  type: 20,
};

const isObject = (value) => value !== null && typeof value === "object";
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function stringValue(value, field, { required = false, nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "string") {
    if (required) throw new Error(`${field} is required`);
    throw new Error(`${field} must be a string`);
  }

  const cleaned = value.trim();
  if (required && !cleaned) throw new Error(`${field} is required`);
  if (STRING_LIMITS[field] && cleaned.length > STRING_LIMITS[field]) {
    throw new Error(`${field} must be ${STRING_LIMITS[field]} characters or fewer`);
  }
  return cleaned;
}

function booleanValue(value, field) {
  if (typeof value !== "boolean") throw new Error(`${field} must be true or false`);
  return value;
}

function displayOrderValue(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("displayOrder must be a non-negative integer");
  }
  return value;
}

function jsonObject(value, field) {
  if (!isObject(value)) throw new Error(`${field} must be an object or array`);
  return value;
}

function sectionData(body, { creating = false } = {}) {
  const data = {};
  if (creating || has(body, "page")) data.page = stringValue(body.page ?? "home", "page", { required: true });
  if (creating || has(body, "key")) data.key = stringValue(body.key, "key", { required: true });
  if (creating || has(body, "label")) data.label = stringValue(body.label, "label", { required: true });
  if (creating || has(body, "content")) data.content = jsonObject(body.content, "content");
  if (has(body, "isVisible")) data.isVisible = booleanValue(body.isVisible, "isVisible");
  if (has(body, "displayOrder")) data.displayOrder = displayOrderValue(body.displayOrder);
  return data;
}

function staffData(body, { creating = false } = {}) {
  const data = {};
  if (creating || has(body, "name")) data.name = stringValue(body.name, "name", { required: true });
  for (const field of OPTIONAL_STRING_FIELDS.staff) {
    if (has(body, field)) data[field] = stringValue(body[field], field, { nullable: true });
  }
  if (has(body, "socialLinks")) data.socialLinks = body.socialLinks === null ? null : jsonObject(body.socialLinks, "socialLinks");
  if (has(body, "isVisible")) data.isVisible = booleanValue(body.isVisible, "isVisible");
  if (has(body, "displayOrder")) data.displayOrder = displayOrderValue(body.displayOrder);
  return data;
}

function testimonialData(body, { creating = false } = {}) {
  const data = {};
  if (creating || has(body, "studentName")) data.studentName = stringValue(body.studentName, "studentName", { required: true });
  if (creating || has(body, "quote")) data.quote = stringValue(body.quote, "quote", { required: true });
  if (creating || has(body, "type")) {
    const type = stringValue(body.type ?? "written", "type", { required: true }).toLowerCase();
    if (!["video", "written"].includes(type)) throw new Error("type must be video or written");
    data.type = type;
  }
  for (const field of OPTIONAL_STRING_FIELDS.testimonial) {
    if (has(body, field)) data[field] = stringValue(body[field], field, { nullable: true });
  }
  if (has(body, "isVerified")) data.isVerified = booleanValue(body.isVerified, "isVerified");
  if (has(body, "isVisible")) data.isVisible = booleanValue(body.isVisible, "isVisible");
  if (has(body, "displayOrder")) data.displayOrder = displayOrderValue(body.displayOrder);
  return data;
}

function contactData(body) {
  const data = {};
  for (const field of OPTIONAL_STRING_FIELDS.contact) {
    if (has(body, field)) data[field] = stringValue(body[field], field, { nullable: true });
  }
  if (has(body, "socialLinks")) data.socialLinks = body.socialLinks === null ? null : jsonObject(body.socialLinks, "socialLinks");
  return data;
}

function sendError(res, error, action) {
  if (error.code === "P2025") return res.status(404).json({ success: false, message: "Content not found" });
  if (error.code === "P2002") return res.status(409).json({ success: false, message: "A section with that key already exists" });
  if (error.message && !error.code) return res.status(400).json({ success: false, message: error.message });
  console.error(`Landing content ${action} error:`, error);
  return res.status(500).json({ success: false, message: `Unable to ${action}` });
}

router.use(verifyAdmin);

// @route GET /api/admin/content
// @desc Get every landing-page record, including hidden records
router.get("/", async (req, res) => {
  try {
    const [sections, staff, testimonials, contact] = await Promise.all([
      prisma.landingPageSection.findMany({ orderBy: [{ page: "asc" }, { displayOrder: "asc" }] }),
      prisma.staffMember.findMany({ orderBy: { displayOrder: "asc" } }),
      prisma.testimonial.findMany({ orderBy: [{ type: "asc" }, { displayOrder: "asc" }] }),
      prisma.landingPageContact.findUnique({ where: { id: "default" } }),
    ]);
    res.json({ success: true, content: { sections, staff, testimonials, contact } });
  } catch (error) {
    sendError(res, error, "load landing content");
  }
});

router.get("/sections", async (req, res) => {
  try {
    const where = req.query.page ? { page: req.query.page } : undefined;
    const sections = await prisma.landingPageSection.findMany({
      where,
      orderBy: [{ page: "asc" }, { displayOrder: "asc" }],
    });
    res.json({ success: true, sections });
  } catch (error) {
    sendError(res, error, "load sections");
  }
});

router.post("/sections", async (req, res) => {
  try {
    const section = await prisma.landingPageSection.create({ data: sectionData(req.body, { creating: true }) });
    res.status(201).json({ success: true, section });
  } catch (error) {
    sendError(res, error, "create section");
  }
});

router.put("/sections/:id", async (req, res) => {
  try {
    const data = sectionData(req.body);
    if (!Object.keys(data).length) throw new Error("Provide at least one field to update");
    const section = await prisma.landingPageSection.update({ where: { id: req.params.id }, data });
    res.json({ success: true, section });
  } catch (error) {
    sendError(res, error, "update section");
  }
});

router.delete("/sections/:id", async (req, res) => {
  try {
    await prisma.landingPageSection.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Section deleted" });
  } catch (error) {
    sendError(res, error, "delete section");
  }
});

router.get("/staff", async (_req, res) => {
  try {
    const staff = await prisma.staffMember.findMany({ orderBy: { displayOrder: "asc" } });
    res.json({ success: true, staff });
  } catch (error) {
    sendError(res, error, "load staff");
  }
});

router.post("/staff", async (req, res) => {
  try {
    const staffMember = await prisma.staffMember.create({ data: staffData(req.body, { creating: true }) });
    res.status(201).json({ success: true, staffMember });
  } catch (error) {
    sendError(res, error, "create staff member");
  }
});

router.put("/staff/:id", async (req, res) => {
  try {
    const data = staffData(req.body);
    if (!Object.keys(data).length) throw new Error("Provide at least one field to update");
    const staffMember = await prisma.staffMember.update({ where: { id: req.params.id }, data });
    res.json({ success: true, staffMember });
  } catch (error) {
    sendError(res, error, "update staff member");
  }
});

router.delete("/staff/:id", async (req, res) => {
  try {
    await prisma.staffMember.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Staff member deleted" });
  } catch (error) {
    sendError(res, error, "delete staff member");
  }
});

router.get("/testimonials", async (req, res) => {
  try {
    const where = req.query.type ? { type: req.query.type } : undefined;
    const testimonials = await prisma.testimonial.findMany({
      where,
      orderBy: [{ type: "asc" }, { displayOrder: "asc" }],
    });
    res.json({ success: true, testimonials });
  } catch (error) {
    sendError(res, error, "load testimonials");
  }
});

router.post("/testimonials", async (req, res) => {
  try {
    const testimonial = await prisma.testimonial.create({ data: testimonialData(req.body, { creating: true }) });
    res.status(201).json({ success: true, testimonial });
  } catch (error) {
    sendError(res, error, "create testimonial");
  }
});

router.put("/testimonials/:id", async (req, res) => {
  try {
    const data = testimonialData(req.body);
    if (!Object.keys(data).length) throw new Error("Provide at least one field to update");
    const testimonial = await prisma.testimonial.update({ where: { id: req.params.id }, data });
    res.json({ success: true, testimonial });
  } catch (error) {
    sendError(res, error, "update testimonial");
  }
});

router.delete("/testimonials/:id", async (req, res) => {
  try {
    await prisma.testimonial.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Testimonial deleted" });
  } catch (error) {
    sendError(res, error, "delete testimonial");
  }
});

router.get("/contact", async (_req, res) => {
  try {
    const contact = await prisma.landingPageContact.findUnique({ where: { id: "default" } });
    res.json({ success: true, contact });
  } catch (error) {
    sendError(res, error, "load contact details");
  }
});

router.put("/contact", async (req, res) => {
  try {
    const data = contactData(req.body);
    if (!Object.keys(data).length) throw new Error("Provide at least one field to update");
    const contact = await prisma.landingPageContact.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });
    res.json({ success: true, contact });
  } catch (error) {
    sendError(res, error, "update contact details");
  }
});

module.exports = router;
