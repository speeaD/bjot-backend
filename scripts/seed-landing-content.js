require("dotenv").config();

const prisma = require("../utils/database");

const sections = [
  {
    page: "home",
    key: "home.hero",
    label: "Hero",
    displayOrder: 0,
    content: {
      eyebrow: "DISCIPLINE || CONSISTENCY || EXCELLENCE",
      heading: "PREPARE DIFFERENT. SCORE HIGHER.",
      description: "Nigeria's most trusted online platform for JAMB, WAEC, NECO & POST-UTME preparation.",
      primaryCta: { label: "Join BJOT Free", href: "/register" },
      secondaryCta: { label: "Explore Premium", href: "#premium" },
      trustText: "Trusted by 30,000+ students",
    },
  },
  {
    page: "home",
    key: "home.statistics",
    label: "Statistics",
    displayOrder: 1,
    content: {
      items: [
        { value: "5,000+", label: "Students Passed" },
        { value: "368", label: "Highest UTME Score Recorded" },
        { value: "30,000+", label: "Students Reached Nationwide" },
        { value: "4+", label: "Years of Impact (2022 – 2026)" },
      ],
    },
  },
  {
    page: "home",
    key: "home.why-bjot",
    label: "Why BJOT",
    displayOrder: 2,
    content: {
      eyebrow: "WHY BJOT",
      heading: "More Than Just A Tutorial",
      description: "Everything you need to excel in your exams, in one place.",
      steps: [
        { title: "Learn", description: "Structured video lessons by the best tutors in the country." },
        { title: "Practice", description: "Thousands of CBT-style questions and past exam papers." },
        { title: "Track", description: "Monitor your progress and performance across every subject." },
        { title: "Perform", description: "Walk into exams confident and get the results you deserve." },
      ],
    },
  },
  {
    page: "home",
    key: "home.how-it-works",
    label: "How BJOT Works",
    displayOrder: 3,
    content: {
      eyebrow: "GETTING STARTED",
      heading: "How BJOT Works",
      description: "Four simple steps between you and your dream score.",
      steps: [
        { title: "Join", description: "Create your free BJOT account in seconds." },
        { title: "Learn", description: "Access lessons and study at your own pace." },
        { title: "Practice", description: "Take BJOT CBTs and mock exams that mimic the real thing." },
        { title: "Improve", description: "Track your progress and keep getting better." },
      ],
    },
  },
  {
    page: "home",
    key: "home.youtube",
    label: "YouTube lessons",
    displayOrder: 4,
    content: {
      eyebrow: "WATCH & LEARN",
      heading: "Free Lessons, Every Week, On YouTube",
      description: "Every BJOT lesson starts right here in our own studio — real tutors breaking down JAMB and WAEC topics step by step, filmed and uploaded so you can rewatch anytime, for free.",
      metrics: [
        { value: "120+", label: "Lesson Videos" },
        { value: "15k+", label: "Subscribers" },
        { value: "500k+", label: "Total Views" },
      ],
      cta: { label: "Subscribe on YouTube", href: "https://youtube.com/@bjot" },
      gallery: [
        { label: "In the studio", caption: "Mathematics — Indices & Logarithms" },
        { label: "Behind the scenes", caption: "Probability — Solved Examples" },
      ],
    },
  },
  {
    page: "home",
    key: "home.cta",
    label: "Call to action",
    displayOrder: 5,
    content: {
      heading: "Join Thousands Of Successful Students Today",
      description: "Your success story begins here. Start learning, practicing, and improving with BJOT — completely free to join.",
      primaryCta: { label: "Join BJOT Free", href: "/register" },
      secondaryCta: { label: "Explore Premium", href: "#premium" },
    },
  },
  {
    page: "about",
    key: "about.introduction",
    label: "About introduction",
    displayOrder: 0,
    content: {
      eyebrow: "ABOUT US",
      heading: "Helping Students Prepare Better, One Day At A Time",
      description: "BJOT (Blast JAMB Online Tutorial) is a leading educational programme and online tutorial in Nigeria, built to help students prepare smarter, study consistently, and perform confidently in major examinations.",
    },
  },
  {
    page: "about",
    key: "about.what-we-do",
    label: "What we do",
    displayOrder: 1,
    content: {
      eyebrow: "WHAT WE DO",
      heading: "A Complete Preparatory Ecosystem",
      description: "We provide a complete preparatory ecosystem that includes structured classes, expert tutors, extensive CBT practice, mock examinations, detailed study resources, and performance tracking for UTME, WAEC, NECO, and POST-UTME candidates. Our approach goes beyond simply teaching topics. We combine rigorous instruction with discipline, consistent practice, and continuous assessment — the structure and accountability students need to build a solid academic foundation and make measurable progress throughout their preparation.",
      highlights: ["Structured classes", "Expert tutors", "Extensive CBT practice", "Mock examinations", "Detailed study resources", "Performance tracking"],
    },
  },
  {
    page: "about",
    key: "about.standard",
    label: "Our standard",
    displayOrder: 2,
    content: { text: "OUR STANDARD DISCIPLINE || CONSISTENCY || EXCELLENCE BJOT — helping students prepare better, one day at a time." },
  },
  {
    page: "support",
    key: "support.introduction",
    label: "Support introduction",
    displayOrder: 0,
    content: {
      eyebrow: "SUPPORT",
      heading: "Frequently Asked Questions",
      description: "Everything you need to know about BJOT — how classes work, what Premium includes, and how we help you prepare for UTME, WAEC, NECO and POST-UTME.",
    },
  },
  {
    page: "support",
    key: "support.faq",
    label: "Frequently asked questions",
    displayOrder: 1,
    content: {
      categories: [
        {
          title: "ABOUT BJOT",
          items: [
            { question: "What is BJOT?", answer: "BJOT (Blast JAMB Online Tutorial) is a comprehensive educational programme designed to help students prepare smarter, study consistently, and perform confidently in major examinations. We provide a complete educational ecosystem that includes structured classes, expert tutors, comprehensive practice tests, bi-weekly mock examinations, detailed study resources, and performance tracking." },
            { question: "What examinations does BJOT prepare students for?", answer: "BJOT provides targeted preparation programmes for UTME, WAEC, NECO, and POST-UTME candidates." },
          ],
        },
        {
          title: "HOW BJOT WORKS",
          items: [
            { question: "How are BJOT classes conducted?", answer: "We utilize a dynamic, multi-platform learning ecosystem. Depending on the specific programme and lesson type, classes are facilitated through WhatsApp, Telegram, and YouTube. Our tutors do not simply forward materials for self-study; they actively break down complex concepts, work through live examples, answer questions in real-time, and expertly guide students through every phase of their preparation." },
            { question: "Is BJOT just a video tutorial?", answer: "Not at all. While high-quality video lessons are a vital component of the BJOT system, they are only one piece of the puzzle. Premium students receive a fully structured curriculum featuring real-time tutor accountability, extensive CBT practice, scheduled mock examinations, and exclusive access to the interactive BJOT learning dashboard." },
            { question: "Does BJOT follow the official examination syllabus?", answer: "Yes. Our curriculum is aligned with the official examination syllabuses. Our tutors systematically guide students through the required topics, ensuring key areas of concentration are covered before exam day." },
            { question: "Do your class schedules fit both working-class people and regular school students?", answer: "Yes, absolutely. All of our live classes and interactive activities are strategically scheduled for the evening from 7:30 PM to 11:30 PM. By this time, working-class students are finished with work, and regular school students are back home and settled, allowing everyone to participate comfortably without scheduling conflicts." },
          ],
        },
        {
          title: "FREE CLASS",
          items: [
            { question: "Does BJOT have a Free Class?", answer: "Yes. We offer a Free Class to allow prospective students to experience the quality of BJOT's teaching methodologies before committing to a Premium subscription." },
            { question: "What is the difference between the Free Class and Premium?", answer: "The Free Class provides a valuable introductory experience, but it is inherently limited in scope and resources. BJOT Premium unlocks the complete preparation system — granting full access to the structured timetable, detailed proprietary learning resources, extensive CBT practice, comprehensive performance analytics, and all interactive dashboard tools." },
            { question: "Can I prepare for my entire examination using only the Free Class?", answer: "We do not recommend this. The Free Class is designed to demonstrate how BJOT works, not to serve as a comprehensive preparation strategy. To properly cover the extensive syllabus and gain the competitive edge needed for high scores, the full Premium programme is required." },
          ],
        },
        {
          title: "PREMIUM",
          items: [
            { question: "What exactly do I get when I join BJOT Premium?", answer: "Premium students unlock the complete BJOT advantage, which includes: scheduled, interactive classes with dedicated subject tutors; in-depth video lessons covering key examination topics; extensive CBT practice to build speed and accuracy; bi-weekly mock examinations simulating the real test environment; full access to the Study Hub and premium learning resources; quizzes and educational games to reinforce active recall; daily attendance and study streak tracking; detailed performance analytics; and a video library available 24/7 to revise and revisit complex topics outside of scheduled class hours." },
            { question: "How much do students improve after joining BJOT?", answer: "Progress on the BJOT platform is highly measurable. While individual results depend heavily on personal discipline, students who consistently maintain our 80% standard in BJOT mock examinations go on to score above 80% in their actual exams. By identifying weak points early and utilizing our targeted video lessons and CBT modules, students see significant, measurable growth." },
            { question: "Is the BJOT website the actual class?", answer: "The website acts as your personal academic headquarters, but it does not replace the classes. Students receive active instruction through BJOT's designated teaching channels and use the website dashboard to practice, review analytics, take assessments, and monitor their overall progress." },
            { question: "Is Premium access subscription-based?", answer: "Yes. To maintain access to the live tutoring, continuous platform updates, and premium resources, an active subscription is required." },
          ],
        },
        {
          title: "YOUTUBE",
          items: [
            { question: "Does BJOT have YouTube lessons?", answer: "Yes. As part of our wider learning ecosystem, we produce educational content and video lessons on YouTube. This is an excellent way for students to familiarize themselves with our teaching style before upgrading to Premium." },
            { question: "Is everything on YouTube free?", answer: "While we provide a selection of valuable free content on our channel, our most detailed, step-by-step curriculum videos and proprietary study breakdowns are strictly reserved for BJOT Premium students." },
            { question: "Where can I find BJOT on YouTube?", answer: "Simply search for BJOT OFFICIAL on YouTube to access our public content library." },
          ],
        },
        {
          title: "RESULTS & PROGRESS",
          items: [
            { question: "Does BJOT guarantee a 300+ score?", answer: "We do not sell magic scores; we provide a proven, high-performance system. We offer clear teaching, solid structure, rigorous practice, and consistent support. Your responsibility is to attend classes, study your materials, practice relentlessly, and treat mock exams like the real thing." },
            { question: "What if I currently have a poor academic background?", answer: "A weak foundation is simply a starting point, not a final destination. BJOT is designed to break down the entire syllabus from scratch. Through structured video lessons, clear resources, and patient tutor follow-ups, we meet you where you are, rebuild your academic foundation, and progressively guide you to where you need to be." },
            { question: "How will I know if my scores are actually improving?", answer: "BJOT utilizes consistent CBT practice and bi-weekly mock examinations to objectively measure your capabilities. Premium students can view their Current Average, Target Score progress, and detailed subject-by-subject analytics directly on the BJOT dashboard." },
            { question: "Do you follow up on individual student personal progress?", answer: "Yes. Through daily attendance tracking, study streak monitoring, dashboard performance analytics, and active tutor follow-ups, we keep a close eye on engagement and scores to ensure students stay on track and improve consistently." },
          ],
        },
        {
          title: "PARENTS & STUDENTS",
          items: [
            { question: "Is BJOT suitable for a student who struggles with consistency?", answer: "BJOT provides clear structure, consistent practice, and strong accountability tools. However, the student must still take responsibility for their preparation." },
            { question: "Can a parent or guardian register a student?", answer: "Yes. We highly encourage parents and guardians to facilitate registration for their wards to ensure they are enrolled in a structured preparatory environment." },
            { question: "How do I join BJOT?", answer: "You can register directly through the BJOT website, or reach out to our support team for personalized guidance regarding the best programme for your needs." },
          ],
        },
      ],
    },
  },
  {
    page: "global",
    key: "global.footer",
    label: "Footer",
    displayOrder: 0,
    content: {
      brand: "BJOT",
      tagline: "Prepare Different, Score Higher. Nigeria's most trusted platform for JAMB, WAEC, NECO & POST-UTME success.",
      copyright: "© 2026 BJOT Blast Jamb Online Tutorial. All rights reserved.",
    },
  },
];

const staff = [
  { name: "Mr. Emmanuel", role: "Tutor", course: "Medicine and Surgery", bio: "Dedicated science instructor focused on simplifying complex biological concepts to help students secure admissions into competitive medical programs.", displayOrder: 1 },
  { name: "Mr. Evidence", role: "Tutor", course: "Quantity Surveying", bio: "Analytical tutor specializing in mathematical reasoning and quantitative problem-solving for aspiring engineering and science students.", displayOrder: 2 },
  { name: "Miss Chioma", role: "Tutor", course: "Medical Laboratory Science", bio: "Experienced educator passionate about breaking down difficult scientific principles and guiding students toward academic excellence.", displayOrder: 3 },
  { name: "Miss Joy", role: "Tutor", course: "Law", bio: "Expert arts and humanities instructor dedicated to sharpening students' critical thinking, language skills, and essay performance.", displayOrder: 4 },
  { name: "Miss Phebe", role: "Tutor", course: "Pure and Industrial Chemistry", bio: "Dynamic science tutor focused on building rock-solid foundations in core chemistry to help students ace their examinations.", displayOrder: 5 },
];

const testimonials = [
  { type: "video", studentName: "Adebayo T.", quote: "BJOT changed my JAMB prep completely — the shortcut CBT and mock exams made all the difference.", score: "341/400", course: "Studying Pharmacy", school: "OAU Ife", videoDuration: "02:14", isVerified: true, displayOrder: 1 },
  { type: "video", studentName: "David O.", quote: "The best platform I used for my UTME prep — it covers every subject with clarity and depth.", score: "338/400", course: "Engineering", school: "UNILAG", videoDuration: "02:14", isVerified: true, displayOrder: 2 },
  { type: "video", studentName: "Ruth I.", quote: "BJOT helped me build confidence and master all my subjects before the big exam day.", score: "321/400", course: "Law", school: "University of Cyprus", videoDuration: "02:14", isVerified: true, displayOrder: 3 },
];

const contact = {
  id: "default",
  email: "blastjambonlinetutorial@gmail.com",
  phone: "+234 916 489 6938",
  whatsapp: "+234 916 489 6938",
  website: "https://www.bjotofficial.com",
  youtube: "BJOT OFFICIAL",
  address: "Lagos, Nigeria",
};

async function seedLandingContent() {
  await prisma.landingPageSection.createMany({ data: sections, skipDuplicates: true });

  if (await prisma.staffMember.count() === 0) {
    await prisma.staffMember.createMany({ data: staff });
  }

  if (await prisma.testimonial.count() === 0) {
    await prisma.testimonial.createMany({ data: testimonials });
  }

  const savedContact = await prisma.landingPageContact.findUnique({ where: { id: "default" } });
  if (!savedContact) await prisma.landingPageContact.create({ data: contact });

  console.log("Landing page content seeded without overwriting existing records.");
}

seedLandingContent()
  .catch((error) => {
    console.error("Unable to seed landing page content:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
