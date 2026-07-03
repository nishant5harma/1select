# One Select — Platform Flow Guide

Complete end-to-end flow for **One Select** (Hiring Engine): an AI-assisted recruitment platform built with React + Vite, Supabase, and Claude.

---

## Table of Contents

0. [Master Flowchart](#0-master-flowchart)
1. [Platform Overview](#1-platform-overview)
2. [User Roles](#2-user-roles)
3. [Authentication & Onboarding](#3-authentication--onboarding)
4. [End-to-End Hiring Lifecycle](#4-end-to-end-hiring-lifecycle)
5. [Company (Client) Flow](#5-company-client-flow)
6. [Recruiter Flow](#6-recruiter-flow)
7. [Candidate (User) Flow](#7-candidate-user-flow)
8. [Admin Flow](#8-admin-flow)
9. [Public & Token-Based Flows](#9-public--token-based-flows)
10. [Pipeline Stages](#10-pipeline-stages)
11. [Route Map](#11-route-map)
12. [Backend & Integrations](#12-backend--integrations)
13. [Data Model (Key Tables)](#13-data-model-key-tables)
14. [Trial & Billing](#14-trial--billing)

---

## 0. Master Flowchart

### 0.1 — Who enters where (all roles)

```mermaid
flowchart TD
    START([Visitor lands on One Select]) --> CHOICE{How do they enter?}

    CHOICE -->|Staff login| LOGIN["/login"]
    CHOICE -->|Company signup| TRIAL["/trial · /client/register · /signup"]
    CHOICE -->|Candidate signup| CREG["/candidate/register"]
    CHOICE -->|Browse jobs| JOBS["/jobs — Public job board"]
    CHOICE -->|Email link| TOKEN["Token URL — no login needed"]

    LOGIN --> AUTH{profiles.user_role}
    AUTH -->|admin| ADM["Admin Portal /admin/*"]
    AUTH -->|recruiter| REC["Recruiter Portal /recruiter/*"]
    AUTH -->|client| CLI["Company Portal /client/*"]
    AUTH -->|candidate| CAN["Candidate Portal /candidate/*"]

    TRIAL --> SS[self-signup edge function]
    SS --> CLI

    CREG --> CV[Upload CV → AI parse]
    CV --> POOL[(talent_pool)]
    POOL --> CAN

    JOBS --> APPLY[Apply + CV]
    APPLY --> PUB[p public-apply edge function]
    PUB --> CAND[(candidates)]

    TOKEN --> TTYPE{Token type}
    TTYPE -->|questionnaire| PQ["/questionnaire/:token"]
    TTYPE -->|video interview| PI["/interview/:token"]
    TTYPE -->|live interview| PL["/live/:token"]
    TTYPE -->|assessment| PA["/assessment/:token"]
    TTYPE -->|schedule| PS["/schedule/:token"]

    style START fill:#F8F4EE,stroke:#B8924A
    style ADM fill:#E8E4DC,stroke:#2D3748
    style REC fill:#E8E4DC,stroke:#2D3748
    style CLI fill:#E8E4DC,stroke:#2D3748
    style CAN fill:#E8E4DC,stroke:#2D3748
```

### 0.2 — Complete hiring flowchart (Recruiter + Company + Candidate)

```mermaid
flowchart TD
    subgraph ADMIN["👤 ADMIN"]
        A1[Invite Recruiter] --> A2[Invite / Register Company]
        A2 --> A3[Assign Recruiter ↔ Company]
        A3 --> A4[Monitor Pipeline Board & Billing]
    end

    subgraph COMPANY["🏢 COMPANY (Client)"]
        C1[Sign up — 14-day trial] --> C2[Post Job / JD Wizard]
        C2 --> C3[View Dashboard Funnel]
        C3 --> C4[Review Screened Candidates]
        C4 --> C5{Approve or Reject?}
        C5 -->|Approve| C6[client_approved = true]
        C5 -->|Reject| C7[client_approved = false]
        C6 --> C8[View Interview Scores & Videos]
        C8 --> C9[Track Reports]
    end

    subgraph RECRUITER["🎯 RECRUITER"]
        R1[Login via Admin invite] --> R2[Select Client → Create Job]
        R2 --> R3{Sourcing channels}
        R3 --> R3A[Upload CVs manually]
        R3 --> R3B[LinkedIn via Apify]
        R3 --> R3C[Talent Pool auto-match]
        R3 --> R3D[Public /jobs applications]
        R3A & R3B & R3C & R3D --> R4[(candidates / job_matches)]
        R4 --> R5[Run AI Screening — Claude]
        R5 --> R6{match_pass?}
        R6 -->|Pass| R7[Shortlist — notify Company]
        R6 -->|Fail| R8[Reject / archive]
        R7 --> R9[Send Interview Invite]
        R9 --> R10[Optional: Assessment / Questionnaire]
        R10 --> R11[Review AI Interview Scores]
        R11 --> R12[Send Offer Letter — AI drafted]
        R12 --> R13{Offer outcome}
        R13 -->|Accepted| R14[Hired — final_decision]
        R13 -->|Declined| R15[Close role]
        R8 --> R16[Pipeline Board — drag stages]
        R14 --> R16
    end

    subgraph CANDIDATE["👤 CANDIDATE (User)"]
        U1[Register / Apply / Get sourced] --> U2[CV in system]
        U2 --> U3[Under Review status]
        U3 --> U4{Screening result}
        U4 -->|Shortlisted| U5[Receive interview email]
        U4 -->|Not progressed| U6[Rejection email]
        U5 --> U7[Complete Questionnaire token]
        U7 --> U8[Record Video Interview token]
        U8 --> U9[Optional: Live interview / Schedule]
        U9 --> U10[Portal: track status & matches]
        U10 --> U11{Final decision}
        U11 -->|Offer| U12[Receive offer email]
        U11 -->|Rejected| U6
    end

    A3 -.->|enables| R2
    C2 -.->|or recruiter creates for client| R2
    R7 -.->|shortlist visible| C4
    C6 -.->|approval gates interview| R9
    R9 -.->|email + token| U5
    R12 -.->|email| U12

    style ADMIN fill:#F3F0EA,stroke:#6B7280
    style COMPANY fill:#FEF9F0,stroke:#B8924A
    style RECRUITER fill:#F0F4FE,stroke:#6B7FD7
    style CANDIDATE fill:#F0FEF4,stroke:#22C55E
```

### 0.3 — Candidate pipeline stage flowchart

```mermaid
flowchart LR
    S1["① Applied / Uploaded<br/><i>uploaded</i>"]
    S2["② Screening<br/><i>screening</i>"]
    S3["③ Passed Screening<br/><i>passed</i>"]
    S4["④ Assessment<br/><i>assessment</i>"]
    S5["⑤ Interview<br/><i>interview</i>"]
    S6["⑥ Strong Hire<br/><i>strong_hire</i>"]
    S7["⑦ Hired<br/><i>hired</i>"]
    SR["✕ Rejected<br/><i>rejected</i>"]

    S1 -->|CV parsed| S2
    S2 -->|AI score pass| S3
    S2 -->|AI score fail| SR
    S3 -->|Company approves| S4
    S3 -->|Company rejects| SR
    S4 -->|Assessment done| S5
    S3 -->|Skip assessment| S5
    S5 -->|AI: Strong Hire| S6
    S5 -->|AI: Hire / Borderline| S6
    S5 -->|AI: Reject| SR
    S6 -->|Offer accepted| S7
    S6 -->|Offer declined| SR

    style S1 fill:#F3F4F6,stroke:#9CA3AF
    style S2 fill:#FEF3C7,stroke:#F59E0B
    style S3 fill:#FEF9F0,stroke:#B8924A
    style S4 fill:#EEF2FF,stroke:#6B7FD7
    style S5 fill:#FEF9F0,stroke:#B8924A
    style S6 fill:#DCFCE7,stroke:#22C55E
    style S7 fill:#BBF7D0,stroke:#16A34A
    style SR fill:#FEE2E2,stroke:#EF4444
```

### 0.4 — Decision flowchart (screening → hire)

```mermaid
flowchart TD
    START([Candidate enters pipeline]) --> SRC{Source?}

    SRC -->|Recruiter upload| UP[Parse CV — Claude]
    SRC -->|LinkedIn Apify| LI[Score profile 1–10]
    SRC -->|Public apply| PA[public-apply function]
    SRC -->|Talent pool match| TP[job_matches row]

    LI -->|Score 7–10| UP
    LI -->|Score 4–6| POOL[(Talent Pool only)]
    LI -->|Score <4| DISCARD[Discarded]

    UP & PA & TP --> SCR[AI Screening vs JD]

    SCR --> SCORE{Match score}
    SCORE -->|Below threshold| REJ1[Rejected — email optional]
    SCORE -->|Above threshold| PASS[match_pass = true]

    PASS --> NOTIFY[Notify Company]
    NOTIFY --> CLIENT{Company decision}
    CLIENT -->|Reject| REJ2[client_approved = false]
    CLIENT -->|Approve| APP[client_approved = true]

    APP --> INV[Send interview invite]
    INV --> Q[Pre-interview questionnaire]
    Q --> VID[Video / Live interview]
    VID --> AISCR[AI scores interview]
    AISCR --> REC{Recommendation}

    REC -->|Reject| REJ3[Rejected]
    REC -->|Hire / Strong Hire| OFFER[AI offer letter]
    OFFER --> ACC{Candidate accepts?}
    ACC -->|Yes| HIRED[Hired ✓]
    ACC -->|No| REJ4[Offer declined]

    REJ1 & REJ2 & REJ3 & REJ4 --> END([End])
    HIRED --> END
    DISCARD --> END
    POOL --> END

    style START fill:#F8F4EE,stroke:#B8924A
    style HIRED fill:#BBF7D0,stroke:#16A34A
    style REJ1 fill:#FEE2E2,stroke:#EF4444
    style REJ2 fill:#FEE2E2,stroke:#EF4444
    style REJ3 fill:#FEE2E2,stroke:#EF4444
    style REJ4 fill:#FEE2E2,stroke:#EF4444
    style DISCARD fill:#F3F4F6,stroke:#9CA3AF
```

> **Tip:** Open this file in GitHub, VS Code, or Cursor with Mermaid preview to render the diagrams. If a diagram does not render, check that your viewer supports Mermaid `flowchart` syntax.

---

## 1. Platform Overview

```mermaid
flowchart TB
    subgraph Public["Public (no login)"]
        PJ["/jobs — Job board"]
        PA["/assessment/:token"]
        PQ["/questionnaire/:token"]
        PI["/interview/:token"]
        PL["/live/:token"]
        PS["/schedule/:token"]
    end

    subgraph Portals["Authenticated Portals"]
        AD["Admin /admin/*"]
        RC["Recruiter /recruiter/*"]
        CL["Company /client/*"]
        CA["Candidate /candidate/*"]
    end

    subgraph Backend["Supabase"]
        DB[(PostgreSQL)]
        EF[Edge Functions]
        AU[Auth]
        ST[Storage]
    end

    subgraph External["External Services"]
        CLAUDE[Anthropic Claude]
        RESEND[Resend Email]
        APIFY[Apify LinkedIn]
    end

    Public --> EF
    Portals --> DB
    Portals --> EF
    EF --> CLAUDE
    EF --> RESEND
    EF --> APIFY
    AU --> Portals
```

**What the platform does**

| Layer | Purpose |
|-------|---------|
| **Company portal** | Post jobs, review AI-screened candidates, approve/reject, view reports |
| **Recruiter portal** | Manage assigned clients, run sourcing & screening, pipeline, interviews, offers |
| **Candidate portal** | Register profile, view job matches, track application status |
| **Admin portal** | Platform ops: users, billing, compliance, analytics, global pipeline |
| **Public pages** | Job applications, video interviews, assessments, scheduling — all via secure tokens |

---

## 2. User Roles

| Role | `user_role` in `profiles` | Default home | Primary job |
|------|----------------------------|--------------|-------------|
| **Admin** | `admin` | `/admin/dashboard` | Platform management, invite users, billing |
| **Recruiter** | `recruiter` | `/recruiter/dashboard` | Execute hiring for assigned companies |
| **Company (Client)** | `client` | `/client/dashboard` | Own jobs & candidates; approve shortlists |
| **Candidate (User)** | `candidate` | `/candidate/dashboard` | Profile, matches, application tracking |

**Access control**

- `ProtectedRoute` in `src/App.jsx` checks Supabase session + `profiles.user_role`
- Wrong role → redirected to that role's dashboard
- Missing profile → `/login?error=profile_missing`

---

## 3. Authentication & Onboarding

### 3.1 Login (`/login`)

```mermaid
sequenceDiagram
    participant U as User
    participant App as Login.jsx
    participant SB as Supabase Auth
    participant DB as profiles

    U->>App: Email + password
    App->>SB: signInWithPassword
    SB-->>App: Session
    App->>DB: Fetch profile
    DB-->>App: user_role
    App->>U: Redirect to role dashboard
```

**Special auth flows**

| Flow | URL signal | Behaviour |
|------|------------|-----------|
| **Invite** | `?type=invite` or invite email link | Set password on first login → role dashboard |
| **Magic link** | `?code=` (no type) | Auto sign-in → role dashboard |
| **Password reset** | `?type=recovery` | New password form → sign in |
| **Auth callback** | `/auth/callback`, `/auth/confirm` | Root redirect by role |

### 3.2 Company registration paths

| Path | URL | Result |
|------|-----|--------|
| Self-signup | `/client/register` | `self-signup` edge function → 14-day trial client |
| Trial landing | `/trial` | Same as above with explicit trial metadata |
| General signup | `/signup` | Company trial account via `self-signup` |
| Admin invite | Admin → Clients → Invite | Magic link email (no plaintext password) |

### 3.3 Recruiter onboarding

```mermaid
flowchart LR
    A[Admin invites recruiter] --> B[invite-user edge function]
    B --> C[Magic link email]
    C --> D[Recruiter sets password]
    D --> E[/recruiter/dashboard]
    A2[Admin assigns clients] --> F[recruiter_clients table]
    F --> E
```

### 3.4 Candidate registration

| Path | URL | Flow |
|------|-----|------|
| Direct register | `/candidate/register` | CV upload → AI parse → `talent_pool` + auth account |
| Public job apply | `/jobs` → Apply | `public-apply` edge function → `candidates` row |
| Recruiter upload | Recruiter job view | CV parse → `candidates` (no portal account unless linked later) |

---

## 4. End-to-End Hiring Lifecycle

This is the core business flow spanning all roles.

```mermaid
flowchart TD
    START([Job Created]) --> SRC

    subgraph Sourcing["1 — Sourcing"]
        SRC[Manual CV upload]
        SRC2[LinkedIn sourcing via Apify]
        SRC3[Public job board apply]
        SRC4[Talent pool auto-match]
        SRC --> POOL[(candidates / job_matches)]
        SRC2 --> POOL
        SRC3 --> POOL
        SRC4 --> POOL
    end

    POOL --> SCR

    subgraph Screening["2 — AI Screening"]
        SCR[Run Screening — Claude scores CV vs JD]
        SCR --> PASS{Score ≥ threshold?}
        PASS -->|Yes| PASSED[match_pass = true]
        PASS -->|No| REJ1[match_pass = false / rejected]
    end

    PASSED --> CLIENT

    subgraph ClientReview["3 — Company Review"]
        CLIENT[Client views shortlisted candidates]
        CLIENT --> DEC{Approve / Reject?}
        DEC -->|Approve| APP[client_approved = true]
        DEC -->|Reject| REJ2[client_approved = false]
    end

    APP --> INT

    subgraph Interview["4 — Interview"]
        INT[Send interview invite]
        INT --> Q[Pre-interview questionnaire]
        Q --> VID[Video interview / Live interview]
        VID --> AI[AI scores interview]
        AI --> SCORE[scores.overallScore + recommendation]
    end

    SCORE --> OFFER

    subgraph Offer["5 — Offer & Hire"]
        OFFER[Recruiter sends offer letter]
        OFFER --> HIRE{Accepted?}
        HIRE -->|Yes| HIRED[final_decision = hired]
        HIRE -->|No| REJ3[Offer rejected]
    end
```

### Lifecycle by actor

| Step | Who triggers | Who sees result |
|------|--------------|-----------------|
| Job created | Recruiter, Company, or Admin | All assigned parties |
| CV sourced | Recruiter, LinkedIn, Public apply, Talent pool | Recruiter |
| AI screening | Recruiter | Recruiter + Company |
| Client approval | Company | Recruiter |
| Interview invite | Recruiter | Candidate (email + token link) |
| Interview completion | Candidate | Recruiter + Company |
| Offer letter | Recruiter | Candidate (email) |
| Hire / reject | Recruiter or Pipeline board | All parties + audit log |

---

## 5. Company (Client) Flow

**Portal:** `/client/*`  
**Nav:** Dashboard → My Jobs → Candidates → Reports → AI Assistant → Settings

### 5.1 Onboarding

```mermaid
flowchart TD
    A[Visit /trial or /client/register] --> B[Fill company details]
    B --> C[self-signup edge function]
    C --> D[profiles: user_role=client, is_trial=true]
    D --> E[Auto sign-in]
    E --> F[/client/dashboard?welcome=1]
```

### 5.2 Day-to-day workflow

```mermaid
flowchart LR
    subgraph Jobs["My Jobs /client/jobs"]
        J1[Create job — status: pending_review]
        J2[JD Wizard / Instant Post]
        J3[Talent pool auto-match runs]
    end

    subgraph Candidates["Candidates /client/candidates"]
        C1[View screened candidates]
        C2[Watch video interviews]
        C3[Approve or Reject with notes]
        C4[Tabs: Approved / For Review / All]
    end

    subgraph Reports["Reports /client/reports"]
        R1[Funnel metrics]
        R2[Export CSV]
    end

    subgraph Chat["AI Assistant /client/chat"]
        CH1[hiring-chat edge function]
    end

    Jobs --> Candidates
    Candidates --> Reports
```

### 5.3 Company actions detail

| Action | Where | Effect |
|--------|-------|--------|
| Post job | `/client/jobs` | Job created (`pending_review` or `active`); talent pool scan starts |
| View candidates | `/client/candidates` | Sees only own jobs' candidates (RLS) |
| Approve candidate | Candidate row / profile | `client_approved = true`, audit `client_approved` |
| Reject candidate | Candidate row / profile | `client_approved = false`, notes saved |
| View interview | Video modal | Plays recorded answers + AI dimension scores |
| AI chat | `/client/chat` | Context-aware hiring assistant |
| Settings | `/client/settings` | Company profile, stakeholders, notifications |

### 5.4 Company restrictions

| State | Behaviour |
|-------|-----------|
| **Trial active** | Full access with soft caps (2 jobs, 25 candidates visible, 15 screenings, etc.) |
| **Trial ending** | Amber nudge banner at 80% of any cap |
| **Trial expired** | Full-screen block; contact sales |
| **Suspended** | Billing hold screen; no portal access |

---

## 6. Recruiter Flow

**Portal:** `/recruiter/*`  
**Nav:** Dashboard → Clients → Jobs → Candidates → Talent Pool → LinkedIn Pool → Talent CRM → Pipeline → Reports → AI Assistant → Settings

### 6.1 Setup

1. Admin invites recruiter via `/admin/recruiters`
2. Recruiter clicks magic link → sets password
3. Admin assigns companies via `recruiter_clients` join table
4. Recruiter sees assigned clients at `/recruiter/clients`

### 6.2 Core workflow

```mermaid
flowchart TD
    subgraph Clients["Clients /recruiter/clients"]
        CL1[View assigned companies]
        CL2[Click → pipeline filtered by client]
    end

    subgraph Jobs["Jobs /recruiter/jobs"]
        J1[Select client for job]
        J2[Create via Quick Add / JD Wizard / Instant Post]
        J3[LinkedIn sourcing fires in background]
        J4[Talent pool match fires in background]
        J5[Upload CVs — PDF/DOCX parse]
        J6[Run AI Screening]
    end

    subgraph Pipeline["Pipeline /recruiter/pipeline"]
        P1[Kanban-style stage view]
        P2[Send interview invites]
        P3[Send assessments]
        P4[Send offer letters]
        P5[Automated interview runner]
    end

    subgraph Talent["Talent modules"]
        T1[Talent Pool — internal CV database]
        T2[LinkedIn Pool — sourced profiles]
        T3[Talent CRM — nurture & outreach]
    end

    Clients --> Jobs
    Jobs --> Pipeline
    Jobs --> Talent
    Talent --> Jobs
```

### 6.3 Recruiter actions detail

| Action | Where | Backend |
|--------|-------|---------|
| Create job | `/recruiter/jobs` | `jobs` insert + `source-linkedin-candidates` + `triggerTalentPoolMatch` |
| Upload CV | Job detail | `fileExtract` + Claude parse → `candidates` |
| Run screening | Job detail | `call-claude` scores each CV vs JD |
| Score feedback | Candidate profile | 👍/👎 saved for model calibration |
| Send video interview | Candidate / pipeline | `send-ai-interview-invite` → token URL `/interview/:token` |
| Send live interview | Candidate / pipeline | `send-live-interview-invite` → `/live/:token` |
| Send assessment | Candidate | `send-assessment-invite` → `/assessment/:token` |
| Send offer | Approved candidate | `send-offer-letter` → AI-drafted letter via email |
| Reject | Candidate | `send-rejection-email` |
| AI assistant | `/recruiter/chat` | `recruiter-chat` edge function |
| Reports | `/recruiter/reports` | Per-client hiring metrics |

### 6.4 LinkedIn sourcing flow

```mermaid
sequenceDiagram
    participant R as Recruiter
    participant FE as Frontend
    participant EF as source-linkedin-candidates
    participant AP as Apify
    participant AI as Claude

    R->>FE: Create / source job
    FE->>EF: job_id, title, skills, location
    EF->>AP: Search up to 25 profiles
    AP-->>EF: LinkedIn profiles
    loop Each profile
        EF->>AI: Score profile vs JD (1-10)
        AI-->>EF: Score
        alt Score 7-10
            EF->>EF: Insert to job pipeline
        else Score 4-6
            EF->>EF: Insert to talent pool
        else Score <4
            EF->>EF: Discard
        end
    end
    EF-->>FE: Sourcing log updated
```

---

## 7. Candidate (User) Flow

**Portal:** `/candidate/*`  
**Nav:** Dashboard → My Matches → My Profile

### 7.1 Registration

```mermaid
flowchart TD
    A[/candidate/register] --> B[Upload CV PDF/DOCX]
    B --> C[Claude extracts name, skills, experience]
    C --> D[Complete profile form]
    D --> E[Create auth account]
    E --> F[talent_pool row linked via candidate_user_id]
    F --> G[/candidate/dashboard]
```

### 7.2 Candidate journey (no login required for interviews)

```mermaid
flowchart LR
    subgraph Portal["Logged-in portal"]
        D1[Dashboard — profile completeness %]
        D2[My Matches — AI-matched jobs]
        D3[My Profile — edit skills, CV]
        D4[Application status tracking]
    end

    subgraph Email["Email token links"]
        E1[/questionnaire/:token]
        E2[/interview/:token]
        E3[/live/:token]
        E4[/assessment/:token]
        E5[/schedule/:token]
    end

    Portal --> Email
```

### 7.3 Status visibility (candidate sees)

| Status | Meaning |
|--------|---------|
| Under review | CV being assessed |
| Shortlisted | Passed screening; interview invite coming |
| Interview reviewed | AI scored interview; decision pending |
| Offer made | `final_decision = hired` path |
| Not progressed | Rejected at screening or final |

### 7.4 Data sources for candidate dashboard

| Source | Table | When used |
|--------|-------|-----------|
| Talent pool profile | `talent_pool` | Registered candidate |
| AI matches | `job_matches` | Pool entries matched to jobs |
| Direct applications | `candidates` | Applied via `/jobs` or recruiter upload with linked account |
| Upcoming interviews | `interview_bookings` | Confirmed scheduling |

---

## 8. Admin Flow

**Portal:** `/admin/*`  
**Nav:** Dashboard, Clients, Recruiters, Jobs, Talent Pool, LinkedIn Pool, Talent CRM, Sourcing, Pipeline, Pipeline Board, Compliance, Analytics, Billing, Settings

### 8.1 Admin responsibilities

```mermaid
flowchart TD
    subgraph Users["User management"]
        U1[Invite recruiters /clients]
        U2[Assign recruiters to clients]
        U3[Delete users]
    end

    subgraph Ops["Operations"]
        O1[Global pipeline /recruiter/pipeline equivalent]
        O2[Pipeline Board — drag-and-drop Kanban]
        O3[Sourcing controls & LinkedIn toggle]
        O4[Compliance & audit review]
    end

    subgraph Business["Business"]
        B1[Billing & subscriptions]
        B2[Analytics dashboards]
        B3[Integration settings]
    end

    Users --> Ops
    Ops --> Business
```

### 8.2 Admin-only capabilities

| Feature | Route | Notes |
|---------|-------|-------|
| Invite users | `/admin/recruiters`, `/admin/clients` | Magic link via `invite-user` |
| Global jobs | `/admin/jobs` | Create jobs for any recruiter |
| Pipeline board | `/admin/board` | Drag cards between stages; logs `stage_move` |
| Billing | `/admin/billing` | Subscription management |
| Compliance | `/admin/compliance` | GDPR / data retention |
| Analytics | `/admin/analytics` | Platform-wide metrics |
| Demo seed | Admin dashboard | `DemoLoader` — seeds sample job + 8 candidates |

---

## 9. Public & Token-Based Flows

These pages require **no login** — access is via secure tokens in URLs.

### 9.1 Public job board (`/jobs`)

```mermaid
sequenceDiagram
    participant C as Candidate
    participant PJ as PublicJobs.jsx
    participant EF as public-apply
    participant DB as candidates

    C->>PJ: Browse active jobs
    C->>PJ: Apply + upload CV
    PJ->>EF: name, email, CV content
    EF->>EF: Rate limit (5/hr per IP)
    EF->>DB: Insert candidate row
    EF-->>PJ: Success
    PJ->>C: Application confirmed
```

### 9.2 Token-based candidate experiences

| Route | Token field | Purpose |
|-------|-------------|---------|
| `/questionnaire/:token` | `interview_invite_token` | Pre-interview form (notice period, salary, right to work) |
| `/interview/:token` | `interview_invite_token` | Async video interview (record answers) |
| `/live/:token` | live interview token | Live video interview session |
| `/schedule/:token` | schedule token | Confirm interview slot (Cal.com integration) |
| `/assessment/:token` | `assessment_tokens.token` | Custom written assessment |

### 9.3 Video interview flow

```mermaid
flowchart TD
    A[Candidate opens /interview/:token] --> B{Token valid?}
    B -->|Expired| X[Show expiry + resend option]
    B -->|Valid| C[Pre-interview briefing]
    C --> D[Record video answers per question]
    D --> E[Upload to Supabase Storage]
    E --> F[save-interview-recording edge function]
    F --> G[AI scores interview dimensions]
    G --> H[Recruiter + Company see scores]
```

---

## 10. Pipeline Stages

### Kanban board columns (`AdminBoard`)

| Stage | Label | Typical entry condition |
|-------|-------|------------------------|
| `uploaded` | Applied / Uploaded | CV received, not yet screened |
| `screening` | Screening | `match_score` exists |
| `passed` | Passed Screening | `match_pass = true` |
| `assessment` | Assessment | Assessment sent/completed |
| `interview` | Interview | Interview invite sent or scored |
| `strong_hire` | Strong Hire | `scores.recommendation = Strong Hire` |
| `hired` | Hired | `final_decision = hired` |
| `rejected` | Rejected | Failed screening or rejected |

### Reporting funnel stages (`api.js`)

`sourced` → `screened` → `interviewed` → `shortlisted` → `offered`

### Stage transitions

- **Automatic:** Screening sets `match_pass`; interview scoring sets `scores`
- **Manual:** Drag on Pipeline Board → `stage_move` audit event
- **Client:** Approve/reject sets `client_approved`
- **Final:** Offer/hire sets `final_decision`

---

## 11. Route Map

### Public routes

| Route | Page |
|-------|------|
| `/` | Redirect by role (or `/login`) |
| `/login` | Staff login (admin, recruiter, client) |
| `/signup` | Company trial signup |
| `/trial` | Trial landing signup |
| `/client/register` | Company self-registration |
| `/candidate/login` | Candidate login |
| `/candidate/register` | Candidate registration |
| `/jobs` | Public job board |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |
| `/questionnaire/:token` | Pre-interview questionnaire |
| `/interview/:token` | Video interview |
| `/live/:token` | Live interview |
| `/schedule/:token` | Schedule confirmation |
| `/assessment/:token` | Written assessment |
| `/auth/callback` | Supabase auth redirect |
| `/auth/confirm` | Supabase email confirm |

### Admin routes (`/admin/*`)

| Route | Page |
|-------|------|
| `/admin/dashboard` | Admin dashboard |
| `/admin/clients` | Manage companies |
| `/admin/recruiters` | Manage recruiters |
| `/admin/jobs` | All jobs |
| `/admin/talent-pool` | Internal talent database |
| `/admin/linkedin-pool` | LinkedIn-sourced profiles |
| `/admin/talent-crm` | CRM / outreach |
| `/admin/sourcing` | Sourcing controls |
| `/admin/pipeline` | Global pipeline runner |
| `/admin/board` | Kanban pipeline board |
| `/admin/compliance` | Compliance |
| `/admin/billing` | Billing |
| `/admin/analytics` | Analytics |
| `/admin/settings` | Platform settings |

### Recruiter routes (`/recruiter/*`)

| Route | Page |
|-------|------|
| `/recruiter/dashboard` | Recruiter dashboard |
| `/recruiter/clients` | Assigned companies |
| `/recruiter/jobs` | Job management + CV upload + screening |
| `/recruiter/candidates` | All candidates across jobs |
| `/recruiter/talent-pool` | Talent pool (shared component) |
| `/recruiter/linkedin-pool` | LinkedIn pool |
| `/recruiter/talent-crm` | Talent CRM |
| `/recruiter/pipeline` | Pipeline per client/job |
| `/recruiter/reports` | Reports |
| `/recruiter/chat` | AI assistant |
| `/recruiter/settings` | Settings |

### Company routes (`/client/*`)

| Route | Page |
|-------|------|
| `/client/dashboard` | Company dashboard + funnel |
| `/client/jobs` | Post & manage jobs |
| `/client/candidates` | Review & approve candidates |
| `/client/reports` | Hiring reports |
| `/client/chat` | AI assistant |
| `/client/settings` | Company settings |

### Candidate routes (`/candidate/*`)

| Route | Page |
|-------|------|
| `/candidate/dashboard` | Profile score, matches, applications |
| `/candidate/matches` | All AI-matched roles |
| `/candidate/profile` | Edit profile & CV |

---

## 12. Backend & Integrations

### Supabase Edge Functions (key)

| Function | Triggered by | Purpose |
|----------|--------------|---------|
| `self-signup` | Company/candidate registration | Create auth user + profile |
| `invite-user` | Admin invite | Magic link for new users |
| `call-claude` | Screening, parsing, chat | All AI calls (server-side) |
| `public-apply` | `/jobs` apply form | Rate-limited public applications |
| `source-linkedin-candidates` | Job creation | Apify LinkedIn search + AI scoring |
| `send-ai-interview-invite` | Recruiter | Video interview email + token |
| `send-live-interview-invite` | Recruiter | Live interview invite |
| `send-assessment-invite` | Recruiter | Assessment token email |
| `send-offer-letter` | Recruiter | AI-drafted offer email |
| `send-rejection-email` | Recruiter | Rejection notification |
| `send-screening-update` | Pipeline | Candidate status email |
| `save-interview-recording` | Video interview | Store + process recordings |
| `hiring-chat` | Client AI chat | Context-aware assistant |
| `recruiter-chat` | Recruiter AI chat | Recruiter assistant |
| `notify-client-shortlist` | Screening complete | Alert company of new matches |
| `client-approval-nudge` | Cron | Remind clients to review |
| `weekly-talent-match` | Cron | Auto-match talent pool to jobs |
| `talent-reengagement` | Cron | Re-engage stale pool candidates |
| `cleanup-stale-data` | Cron | Data retention |

### External services

| Service | Secret | Used for |
|---------|--------|----------|
| **Anthropic** | `ANTHROPIC_API_KEY` | CV screening, interview scoring, JD analysis, chat |
| **Resend** | `RESEND_API_KEY` | All transactional email |
| **Apify** | `APIFY_API_TOKEN` | LinkedIn profile search |

---

## 13. Data Model (Key Tables)

```mermaid
erDiagram
    profiles ||--o{ jobs : "recruiter_id (client owns job)"
    profiles ||--o{ recruiter_clients : "recruiter_id"
    profiles ||--o{ recruiter_clients : "client_id"
    jobs ||--o{ candidates : "job_id"
    jobs ||--o{ job_matches : "job_id"
    talent_pool ||--o{ job_matches : "talent_id"
    talent_pool ||--o| profiles : "candidate_user_id"
    candidates ||--o| assessment_tokens : "candidate_id"
    candidates }o--o| profiles : "candidate_user_id"
    jobs ||--o{ interview_bookings : "job_id"
    profiles ||--o{ audit_log : "actor_id"
```

| Table | Purpose |
|-------|---------|
| `profiles` | User identity, role, company, trial/billing status |
| `recruiter_clients` | Many-to-many: which recruiter serves which company |
| `jobs` | Job postings (owned by company via `recruiter_id`) |
| `candidates` | Per-job applicant records (CV, scores, stage, approval) |
| `talent_pool` | Central candidate database (registered + imported) |
| `job_matches` | Talent pool ↔ job AI matches |
| `linkedin_sourcing_log` | LinkedIn sourcing run history |
| `assessment_tokens` | Tokenized written assessments |
| `interview_bookings` | Scheduled live interviews |
| `audit_log` | Immutable action log (`job_created`, `client_approved`, `stage_move`, etc.) |
| `ip_rate_limits` | Public apply rate limiting |

---

## 14. Trial & Billing

### Trial limits (`src/config/trialLimits.js`)

| Cap | Limit | Behaviour |
|-----|-------|-----------|
| Jobs | 2 | Soft cap |
| Visible candidates | 25 | Soft cap |
| AI screenings | 15 | Nudge at 80% |
| AI chat messages | 20 | Nudge at 80% |
| LinkedIn sourcing runs | 2 | Nudge at 80% |
| Trial duration | 14 days | Full block when expired |

**Trial includes:** AI screening, interview invites, full profiles, pipeline, offers, chat  
**Trial excludes:** Report downloads, HRIS webhooks

### Subscription states (`profiles`)

| Status | Portal access |
|--------|---------------|
| `trial` (active) | Full with soft caps |
| `active` | Paid — no caps |
| `expired` | Blocked — contact sales |
| `suspended` | Blocked — billing hold |

---

## Quick Reference — Role Permissions

| Capability | Admin | Recruiter | Company | Candidate |
|------------|:-----:|:---------:|:-------:|:---------:|
| Invite users | ✓ | — | — | — |
| Create jobs | ✓ | ✓ (assigned clients) | ✓ (own) | — |
| Upload / source CVs | ✓ | ✓ | — | ✓ (own profile) |
| Run AI screening | ✓ | ✓ | View results | — |
| Approve candidates | — | — | ✓ | — |
| Send interviews | ✓ | ✓ | — | Take (via token) |
| Send offers | ✓ | ✓ | — | Receive |
| Pipeline board | ✓ | ✓ | — | — |
| Billing | ✓ | — | — | — |
| View other companies' data | ✓ | — | — | — |

---

## Demo Walkthrough (Happy Path)

Reference: `SMOKE_TEST.md`

1. **Admin** invites recruiter → `/admin/recruiters`
2. **Recruiter** logs in, creates job → `/recruiter/jobs`
3. **Recruiter** uploads 3 CVs, runs screening
4. **Recruiter** sends video interview to top candidate
5. **Company** logs in, views candidates → `/client/candidates`
6. **Company** approves a candidate
7. **Recruiter** sends AI-drafted offer letter
8. **Admin** verifies `audit_log` entries

---

*Generated from codebase analysis. Stack: React 19 + Vite 8 + Supabase + Claude. Deployed on Vercel with SPA rewrites.*
