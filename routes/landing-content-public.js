const express = require("express");
const router = express.Router();
const prisma = require("../utils/database");

const visibleOrder = { isVisible: true };

function serverError(res, error) {
  console.error("Public landing content error:", error);
  return res.status(500).json({ success: false, message: "Unable to load landing page content" });
}

// @route GET /api/public/content
// @desc Get all content the public landing page should render
router.get("/", async (_req, res) => {
  try {
    const [sections, staff, testimonials, contact] = await Promise.all([
      prisma.landingPageSection.findMany({
        where: visibleOrder,
        orderBy: [{ page: "asc" }, { displayOrder: "asc" }],
      }),
      prisma.staffMember.findMany({ where: visibleOrder, orderBy: { displayOrder: "asc" } }),
      prisma.testimonial.findMany({
        where: visibleOrder,
        orderBy: [{ type: "asc" }, { displayOrder: "asc" }],
      }),
      prisma.landingPageContact.findUnique({ where: { id: "default" } }),
    ]);
    res.json({ success: true, content: { sections, staff, testimonials, contact } });
  } catch (error) {
    serverError(res, error);
  }
});

router.get("/sections/:key", async (req, res) => {
  try {
    const section = await prisma.landingPageSection.findFirst({
      where: { key: req.params.key, isVisible: true },
    });
    if (!section) return res.status(404).json({ success: false, message: "Section not found" });
    res.json({ success: true, section });
  } catch (error) {
    serverError(res, error);
  }
});

router.get("/staff", async (_req, res) => {
  try {
    const staff = await prisma.staffMember.findMany({ where: visibleOrder, orderBy: { displayOrder: "asc" } });
    res.json({ success: true, staff });
  } catch (error) {
    serverError(res, error);
  }
});

router.get("/testimonials", async (req, res) => {
  try {
    const where = { ...visibleOrder };
    if (req.query.type) where.type = req.query.type;
    const testimonials = await prisma.testimonial.findMany({
      where,
      orderBy: [{ type: "asc" }, { displayOrder: "asc" }],
    });
    res.json({ success: true, testimonials });
  } catch (error) {
    serverError(res, error);
  }
});

router.get("/contact", async (_req, res) => {
  try {
    const contact = await prisma.landingPageContact.findUnique({ where: { id: "default" } });
    res.json({ success: true, contact });
  } catch (error) {
    serverError(res, error);
  }
});

module.exports = router;
