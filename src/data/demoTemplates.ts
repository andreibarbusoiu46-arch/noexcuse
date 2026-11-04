// Generated from the challenge_templates table (supabase/migrations) so demo mode shows the real library.
import type { ChallengeTemplate } from './types';

export const demoTemplates: ChallengeTemplate[] = [
 {
  "id": "discipline-30",
  "kind": "thirty_day",
  "rules": "Keep your chosen commitment on every scheduled day for 30 days. Up to 2 missed days.",
  "title": "30 Days of Discipline",
  "tagline": "One commitment. Thirty days. Up to two misses.",
  "category": "personal",
  "evidence": "Whatever your commitment already asks for, at its verification level.",
  "difficulty": "intermediate",
  "habit_time": null,
  "objectives": null,
  "proof_hint": null,
  "description": "Pick any commitment you already have and keep it for 30 days. You can miss at most two scheduled days.",
  "habit_title": null,
  "duration_days": 30,
  "allowed_misses": 2,
  "habit_weekdays": null
 },
 {
  "id": "no-excuses-30",
  "kind": "thirty_day",
  "rules": "Every scheduled day for 30 days. A single missed day ends the challenge.",
  "title": "30 Days Without Excuses",
  "tagline": "Thirty days. Zero misses.",
  "category": "personal",
  "evidence": "Whatever your commitment already asks for, at its verification level.",
  "difficulty": "advanced",
  "habit_time": null,
  "objectives": null,
  "proof_hint": null,
  "description": "Keep one commitment every scheduled day for 30 days. A single miss ends the challenge.",
  "habit_title": null,
  "duration_days": 30,
  "allowed_misses": 0,
  "habit_weekdays": null
 },
 {
  "id": "early-7",
  "kind": "seven_day",
  "rules": "7 days, no misses. The window is 04:45–05:15.",
  "title": "5 AM Protocol",
  "tagline": "Up and moving at 05:00, seven days straight.",
  "category": "lifestyle",
  "evidence": "One live photo: you, awake, with the time visible.",
  "difficulty": "advanced",
  "habit_time": "05:00:00",
  "objectives": [
   {
    "time": "05:00",
    "title": "Up at 05:00",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "My face and a clock or phone screen showing the time, in a lit room.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": "My face and a clock or phone screen showing the time, in a lit room.",
  "description": "Seven mornings in a row, out of bed at 05:00 and proving it before the day starts.",
  "habit_title": "Up at 05:00",
  "duration_days": 7,
  "allowed_misses": 0,
  "habit_weekdays": [
   1,
   2,
   3,
   4,
   5,
   6,
   7
  ]
 },
 {
  "id": "fitness-30",
  "kind": "thirty_day",
  "rules": "30 days, up to 3 missed days.",
  "title": "No Excuses Fitness",
  "tagline": "A workout a day for 30 days.",
  "category": "fitness",
  "evidence": "One live photo of you training, or the equipment with you in frame.",
  "difficulty": "intermediate",
  "habit_time": "18:00:00",
  "objectives": [
   {
    "time": "18:00",
    "title": "Workout — 30 min",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "Me training, or the gym floor / equipment with me in frame.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": "Me training, or the gym floor / equipment with me in frame.",
  "description": "Train every day for 30 days — gym, run or home workout. The photo has to show it.",
  "habit_title": "Workout — 30 min",
  "duration_days": 30,
  "allowed_misses": 3,
  "habit_weekdays": [
   1,
   2,
   3,
   4,
   5,
   6,
   7
  ]
 },
 {
  "id": "deep-work-21",
  "kind": "custom",
  "rules": "Every weekday for three weeks. 1 missed day allowed.",
  "title": "21 Days of Deep Work",
  "tagline": "Ninety focused minutes, every weekday.",
  "category": "productivity",
  "evidence": "Your desk with the focus timer or the work on screen.",
  "difficulty": "intermediate",
  "habit_time": "09:00:00",
  "objectives": [
   {
    "time": "09:00",
    "title": "Deep work — 90 min",
    "weekdays": [
     1,
     2,
     3,
     4,
     5
    ],
    "proof_hint": "My desk with the focus timer or the work itself on screen.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": "My desk with the focus timer or the work itself on screen.",
  "description": "Three weeks of weekday deep-work blocks. One miss allowed.",
  "habit_title": "Deep work — 90 min",
  "duration_days": 21,
  "allowed_misses": 1,
  "habit_weekdays": [
   1,
   2,
   3,
   4,
   5
  ]
 },
 {
  "id": "reading-30",
  "kind": "thirty_day",
  "rules": "30 days, up to 2 missed days.",
  "title": "Reading Discipline",
  "tagline": "Twenty pages every night for a month.",
  "category": "education",
  "evidence": "The open book with the page number visible.",
  "difficulty": "beginner",
  "habit_time": "21:30:00",
  "objectives": [
   {
    "time": "21:30",
    "title": "Read 20 pages",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "The open book with the page number visible.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": "The open book with the page number visible.",
  "description": "Read every evening for 30 days. Two misses allowed.",
  "habit_title": "Read 20 pages",
  "duration_days": 30,
  "allowed_misses": 2,
  "habit_weekdays": [
   1,
   2,
   3,
   4,
   5,
   6,
   7
  ]
 },
 {
  "id": "iron-75",
  "kind": "elite",
  "rules": "75 days. Every objective, every day. One miss ends the challenge.",
  "title": "75-Day Iron Standard",
  "tagline": "Two workouts, ten pages, three litres. Every day for 75 days.",
  "category": "fitness",
  "evidence": "One live photo per objective, inside each window.",
  "difficulty": "elite",
  "habit_time": null,
  "objectives": [
   {
    "time": "07:00",
    "title": "Workout — 45 min",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "Me training, with the gym or equipment in frame.",
    "verification_level": "standard"
   },
   {
    "time": "18:00",
    "title": "Outdoor workout — 45 min",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "Me training outdoors, sky or street visible.",
    "verification_level": "standard"
   },
   {
    "time": "21:00",
    "title": "Read 10 pages",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "The open book with the page number visible.",
    "verification_level": "standard"
   },
   {
    "time": "20:00",
    "title": "Drink 3 L of water",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "The empty bottles that add up to three litres.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": null,
  "description": "A demanding 75-day discipline program inspired by popular 75-day challenges (not affiliated with any of them). Two workouts a day — one outdoors — ten pages of reading and three litres of water. Every day, no exceptions.",
  "habit_title": null,
  "duration_days": 75,
  "allowed_misses": 0,
  "habit_weekdays": null
 },
 {
  "id": "deep-work-7",
  "kind": "seven_day",
  "rules": "7 days, 1 missed day allowed.",
  "title": "Deep Work 7D",
  "tagline": "Ninety focused minutes, seven days running.",
  "category": "productivity",
  "evidence": "One live photo of the work and the timer.",
  "difficulty": "beginner",
  "habit_time": null,
  "objectives": [
   {
    "time": "09:00",
    "title": "Deep work — 90 min",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "My desk with the focus timer or the work itself on screen.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": null,
  "description": "A one-week reset for your attention: one 90-minute deep-work block every morning.",
  "habit_title": null,
  "duration_days": 7,
  "allowed_misses": 1,
  "habit_weekdays": null
 },
 {
  "id": "digital-detox",
  "kind": "custom",
  "rules": "14 days, up to 2 missed days.",
  "title": "Digital Detox",
  "tagline": "Two phone-free hours every evening for two weeks.",
  "category": "lifestyle",
  "evidence": "One live photo of the phone put away, with the time visible.",
  "difficulty": "intermediate",
  "habit_time": null,
  "objectives": [
   {
    "time": "20:00",
    "title": "Phone off — 2 hours",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "The phone switched off or in a drawer, with a clock showing the time.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": null,
  "description": "Take your evenings back: the phone goes off for two hours, every evening, for 14 days.",
  "habit_title": null,
  "duration_days": 14,
  "allowed_misses": 2,
  "habit_weekdays": null
 },
 {
  "id": "study-14",
  "kind": "custom",
  "rules": "10 study days, 1 missed day allowed.",
  "title": "Study Consistency",
  "tagline": "An hour of study every weekday for two weeks.",
  "category": "education",
  "evidence": "One live photo of your study material and the timer.",
  "difficulty": "beginner",
  "habit_time": null,
  "objectives": [
   {
    "time": "19:00",
    "title": "Study — 60 min",
    "weekdays": [
     1,
     2,
     3,
     4,
     5
    ],
    "proof_hint": "My notes or book open, with the timer visible.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": null,
  "description": "Build a study habit that survives a busy week: one focused hour, Monday to Friday, for two weeks.",
  "habit_title": null,
  "duration_days": 14,
  "allowed_misses": 1,
  "habit_weekdays": null
 },
 {
  "id": "daily-reset",
  "kind": "daily",
  "rules": "All three objectives today.",
  "title": "Daily Reset",
  "tagline": "Three small wins in one day.",
  "category": "personal",
  "evidence": "One live photo per objective.",
  "difficulty": "beginner",
  "habit_time": null,
  "objectives": [
   {
    "time": "07:30",
    "title": "Make the bed",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "The made bed.",
    "verification_level": "standard"
   },
   {
    "time": "18:00",
    "title": "Move — 20 min",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "Me exercising or walking.",
    "verification_level": "standard"
   },
   {
    "time": "21:30",
    "title": "Plan tomorrow",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "Tomorrow's plan written down.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": null,
  "description": "One day, three proofs: make the bed, move for twenty minutes, plan tomorrow.",
  "habit_title": null,
  "duration_days": 1,
  "allowed_misses": 0,
  "habit_weekdays": null
 },
 {
  "id": "four-of-seven",
  "kind": "weekly",
  "rules": "At least 4 of 7 days (up to 3 missed days).",
  "title": "Four of Seven",
  "tagline": "Train on at least four days this week.",
  "category": "fitness",
  "evidence": "One live photo of you training.",
  "difficulty": "beginner",
  "habit_time": null,
  "objectives": [
   {
    "time": "18:00",
    "title": "Workout — 30 min",
    "weekdays": [
     1,
     2,
     3,
     4,
     5,
     6,
     7
    ],
    "proof_hint": "Me training, with the equipment or place visible.",
    "verification_level": "standard"
   }
  ],
  "proof_hint": null,
  "description": "A weekly challenge for real life: a 30-minute workout on any four of the next seven days.",
  "habit_title": null,
  "duration_days": 7,
  "allowed_misses": 3,
  "habit_weekdays": null
 }
];
