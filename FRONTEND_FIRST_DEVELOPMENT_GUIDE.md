# Brick Business Management System

## Frontend-First Development Guide

> Build the complete frontend first, show it to the client, collect
> feedback, get approval, freeze the UI, and only then start the
> backend.

## 1. Development Strategy

``` text
REQUIREMENTS
     ↓
FRONTEND PROTOTYPE
     ↓
CLIENT DEMO
     ↓
CLIENT FEEDBACK
     ↓
UI/UX APPROVAL
     ↓
UI FREEZE
     ↓
DATABASE DESIGN
     ↓
BACKEND
     ↓
API INTEGRATION
     ↓
TESTING
     ↓
BACKUP + DEPLOYMENT
```

During frontend development: - React + Vite - React Router - Mock/local
data - Reusable components - Responsive design - No MongoDB connection -
No Express APIs yet - No production financial calculations

## 2. Final Client-Server Structure

``` text
brick-business-management-system/
│
├── client/                         # React frontend
├── server/                         # Node + Express backend
├── docs/
│   ├── FRONTEND_FIRST_DEVELOPMENT_GUIDE.md
│   ├── BUSINESS_RULES.md
│   ├── DATABASE_DESIGN.md
│   ├── API_DOCUMENTATION.md
│   └── CLIENT_FEEDBACK.md
├── .gitignore
└── README.md
```

### Client

``` text
client/
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── common/
│   │   ├── forms/
│   │   └── ui/
│   ├── context/
│   ├── features/
│   │   ├── dashboard/
│   │   ├── labours/
│   │   ├── attendance/
│   │   ├── payments/
│   │   ├── salary/
│   │   ├── trucks/
│   │   ├── reports/
│   │   └── settings/
│   ├── hooks/
│   ├── layouts/
│   │   ├── MainLayout.jsx
│   │   ├── Sidebar.jsx
│   │   ├── Header.jsx
│   │   └── MobileBottomNav.jsx
│   ├── mock/
│   │   ├── dashboard.js
│   │   ├── labours.js
│   │   ├── attendance.js
│   │   ├── payments.js
│   │   ├── salary.js
│   │   └── trucks.js
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── Dashboard.jsx
│   │   ├── LabourManagement.jsx
│   │   ├── LabourProfile.jsx
│   │   ├── Attendance.jsx
│   │   ├── Payments.jsx
│   │   ├── Salary.jsx
│   │   ├── Trucks.jsx
│   │   ├── Reports.jsx
│   │   └── Settings.jsx
│   ├── routes/
│   │   └── AppRoutes.jsx
│   ├── services/
│   │   └── api.js
│   ├── utils/
│   │   ├── calculations.js
│   │   ├── formatCurrency.js
│   │   └── formatDate.js
│   ├── validators/
│   ├── App.jsx
│   └── main.jsx
├── package.json
└── .env
```

### Server

``` text
server/
├── config/
│   ├── db.js
│   └── env.js
├── constants/
│   ├── attendance.js
│   ├── paymentTypes.js
│   └── roles.js
├── controllers/
│   ├── auth.controller.js
│   ├── labour.controller.js
│   ├── attendance.controller.js
│   ├── payment.controller.js
│   ├── salary.controller.js
│   ├── truck.controller.js
│   └── report.controller.js
├── cron/
│   └── backup.cron.js
├── jobs/
│   └── databaseBackup.js
├── middlewares/
│   ├── auth.middleware.js
│   ├── role.middleware.js
│   ├── error.middleware.js
│   └── validation.middleware.js
├── models/
│   ├── User.js
│   ├── Labour.js
│   ├── LabourRateHistory.js
│   ├── Attendance.js
│   ├── Payment.js
│   ├── SalaryPeriod.js
│   ├── Truck.js
│   ├── TruckStatusHistory.js
│   └── AuditLog.js
├── routes/
│   ├── auth.routes.js
│   ├── labour.routes.js
│   ├── attendance.routes.js
│   ├── payment.routes.js
│   ├── salary.routes.js
│   ├── truck.routes.js
│   └── report.routes.js
├── services/
│   ├── auth.service.js
│   ├── labour.service.js
│   ├── attendance.service.js
│   ├── payment.service.js
│   ├── salary.service.js
│   ├── truck.service.js
│   └── report.service.js
├── utils/
├── validators/
├── uploads/
├── temp/
├── app.js
├── server.js
├── package.json
└── .env
```

## 3. Architecture Rules

Frontend:

``` text
Page
 ↓
Feature Components
 ↓
Reusable UI Components
 ↓
Mock Data        ← frontend stage
```

Final application:

``` text
React
 ↓
Service / Axios
 ↓
Express Route
 ↓
Middleware
 ↓
Controller
 ↓
Service
 ↓
Mongoose Model
 ↓
MongoDB
```

Do not put the entire application in a few huge components.

## 4. Development Phases

``` text
PHASE 0  → Requirements + Business Rules
PHASE 1  → React/Vite Setup
PHASE 2  → Design System
PHASE 3  → Main Layout + Routing
PHASE 4  → Dashboard
PHASE 5  → Labour Management
PHASE 6  → Labour Profile
PHASE 7  → Attendance
PHASE 8  → Payments
PHASE 9  → Weekly Salary
PHASE 10 → Trucks
PHASE 11 → Reports
PHASE 12 → Settings
PHASE 13 → Responsive Polish
PHASE 14 → Client Demo
PHASE 15 → Client Feedback + UI Freeze

              ↓ ONLY AFTER APPROVAL

PHASE 16 → Database Design
PHASE 17 → Backend Setup
PHASE 18 → Backend APIs
PHASE 19 → Frontend/API Integration
PHASE 20 → Business Logic + Security
PHASE 21 → Backup
PHASE 22 → Testing + Deployment
```

# PHASE 0 --- Requirements + Business Rules

Document the client's rules before UI development.

### Labour

-   Labour ID
-   Name
-   Mobile
-   Address
-   Joining date
-   Daily rate
-   Active/inactive status
-   Rate change rules

### Attendance

``` text
PRESENT
HALF_DAY
ABSENT
```

Confirm: - Can previous attendance be edited? - Can processed attendance
be changed? - Who can edit attendance?

### Payments

``` text
BOOKING_ADVANCE
SALARY_PAYMENT
OTHER
```

Confirm: - Multiple advances? - Payment correction rules? - Can
financial records be deleted? - Is a note/reason required?

### Weekly Salary

Confirm: - Week start/end - Salary payment day - Sunday handling -
Half-day calculation - Advance deduction - Unpaid balance handling

### Trucks

``` text
WORKING
STOPPED
MAINTENANCE
```

Confirm: - Truck number - Driver - Model/type - Reason for stopping -
Maintenance information - Status history

Document these in `docs/BUSINESS_RULES.md`.

### Done when

-   [ ] Requirements documented
-   [ ] Business rules confirmed
-   [ ] Open questions listed
-   [ ] Client workflow understood

# PHASE 1 --- React Setup

``` bash
mkdir brick-business-management-system
cd brick-business-management-system

npm create vite@latest client -- --template react
cd client

npm install
npm install react-router-dom axios
```

Then create the planned folders.

### Done when

-   [ ] Vite app works
-   [ ] React Router installed
-   [ ] Axios installed
-   [ ] Folder structure created
-   [ ] Git initialized
-   [ ] First commit created

Do not start with the Dashboard.

# PHASE 2 --- Design System

Define:

``` text
Primary
Secondary
Background
Surface
Text
Muted Text
Success
Warning
Danger
Border
```

Typography:

``` text
Page Heading
Section Heading
Card Heading
Body
Small Text
Table Text
Button Text
```

Build reusable components:

``` text
Button
Input
Select
Textarea
SearchInput
Card
StatCard
Badge
Modal
Dropdown
Table
Tabs
DatePicker
Toast
ConfirmDialog
EmptyState
LoadingState
```

Example:

``` jsx
<Button variant="primary">
  Add Labour
</Button>
```

### Done when

-   [ ] Buttons/forms are consistent
-   [ ] Cards/tables/modals are consistent
-   [ ] Typography is defined
-   [ ] Responsive rules are considered

# PHASE 3 --- Main Layout + Routing

Build:

``` text
MainLayout.jsx
Sidebar.jsx
Header.jsx
MobileBottomNav.jsx
```

Desktop:

``` text
┌──────────────┬──────────────────────────┐
│   Sidebar    │ Header                   │
│              ├──────────────────────────┤
│              │ Page Content             │
└──────────────┴──────────────────────────┘
```

Mobile:

``` text
┌─────────────────────┐
│ Header              │
├─────────────────────┤
│ Page Content        │
├─────────────────────┤
│ Bottom Navigation   │
└─────────────────────┘
```

Navigation:

``` text
Dashboard
Labours
Attendance
Payments
Salary
Trucks
Reports
Settings
```

Configure `src/routes/AppRoutes.jsx`.

# PHASE 4 --- Dashboard

Use mock data.

Summary cards:

``` text
Total Labour
Present Today
Half Day
Absent
Working Trucks
Stopped Trucks
Pending Salary
Weekly Payments
```

Sections:

-   Attendance summary
-   Weekly salary summary
-   Payment summary
-   Truck status
-   Recent payments
-   Recent activities

Use `src/mock/dashboard.js`.

# PHASE 5 --- Labour Management

Components:

``` text
LabourSummaryCards
LabourFilters
LabourTable
AddLabourModal
EditLabourModal
```

List:

``` text
Labour ID
Name
Mobile
Daily Rate
Status
Present Days
Balance
Actions
```

Search:

``` text
Name
Mobile
Labour ID
```

Filters:

``` text
All
Active
Inactive
```

Add labour:

``` text
Labour ID
Name
Mobile
Address
Joining Date
Daily Rate
Status
```

Use mock/local state.

# PHASE 6 --- Labour Profile

Show:

``` text
Name
Labour ID
Mobile
Joining Date
Daily Rate
Status
```

Attendance:

``` text
Present Days
Half Days
Absent Days
Working Units
```

Financial summary:

``` text
Earned Salary
Booking Advance
Salary Payments
Total Received
Balance Salary
```

Tabs:

``` text
Overview
Attendance
Payments
Rate History
```

Keep rate history because a labour's daily rate can change.

# PHASE 7 --- Attendance

Daily screen:

``` text
Date
Search Labour
Mark All Present
Save Attendance
```

Each labour:

``` text
Name | Present | Half Day | Absent
```

Summary:

``` text
Present: 25
Half Day: 4
Absent: 3
```

Prioritize mobile usability.

# PHASE 8 --- Payments

Payment form:

``` text
Labour
Payment Type
Amount
Date
Note
```

Types:

``` text
Booking Advance
Salary Payment
Other
```

History:

``` text
Date
Labour
Type
Amount
Note
Actions
```

Use mock data.

# PHASE 9 --- Weekly Salary

Show:

``` text
Week: 01 Oct - 07 Oct

Labour
Working Units
Daily Rate
Earned Salary
Received
Balance
```

Prototype:

``` text
Working Units =
Present Days + (Half Days × 0.5)

Earned Salary =
Working Units × Daily Rate

Balance =
Earned Salary - Total Received
```

Example:

``` text
Present = 5
Half Day = 1
Rate = ₹700

Working Units = 5.5
Earned Salary = ₹3,850
```

Actions:

``` text
View Details
Process Week
Export
```

These are prototype calculations. Final financial calculations belong to
the backend.

# PHASE 10 --- Trucks

Summary:

``` text
Total Trucks
Working
Stopped
Maintenance
```

Table:

``` text
Truck Number
Driver
Model
Status
Reason
Actions
```

Statuses:

``` text
WORKING
STOPPED
MAINTENANCE
```

If stopped, show the reason.

# PHASE 11 --- Truck Details + History

Profile:

``` text
Truck Number
Driver
Model
Current Status
```

Tabs:

``` text
Overview
Status History
Maintenance
```

History:

``` text
Date
Previous Status
New Status
Reason
```

# PHASE 12 --- Reports

Report types:

``` text
Labour Report
Attendance Report
Payment Report
Salary Report
Truck Report
```

Filters:

``` text
Date Range
Labour
Truck
Status
Payment Type
```

Actions:

``` text
View
Export CSV
Export Excel
Export PDF
```

During frontend development, export actions can be placeholders.

# PHASE 13 --- Settings

Sections:

``` text
Business Profile
User Profile
Preferences
Security
Backup Status
```

Backup is only visual during frontend development.

# PHASE 14 --- Mock Data + Interactivity

Keep mock data in:

``` text
src/mock/
├── dashboard.js
├── labours.js
├── attendance.js
├── payments.js
├── salary.js
└── trucks.js
```

Before client review implement:

-   Add/edit labour
-   Search/filter labour
-   Open labour profile
-   Mark attendance
-   Record payment
-   Change truck status
-   Search/filter trucks
-   Change date/week
-   Confirmation dialogs
-   Toast messages
-   Loading states
-   Empty states
-   Error states

Still use mock/local state.

# PHASE 15 --- Responsive Polish

Test:

``` text
320px
375px
390px
414px
768px
1024px
1366px
1920px
```

Support:

``` text
Mobile
Tablet
Laptop
Desktop
```

# PHASE 16 --- Client Demo

Before the demo:

-   Fix broken buttons
-   Fix console errors
-   Fix horizontal scrolling
-   Fix inconsistent spacing
-   Remove unfinished pages
-   Remove placeholder text
-   Use realistic demo data

Demo flow:

``` text
Login
  ↓
Dashboard
  ↓
Labour Management
  ↓
Labour Profile
  ↓
Attendance
  ↓
Payments
  ↓
Weekly Salary
  ↓
Trucks
  ↓
Reports
  ↓
Settings
```

# PHASE 17 --- Client Feedback

Create:

``` text
docs/CLIENT_FEEDBACK.md
```

Template:

``` text
## Feedback #001

Date:
Screen:
Client Feedback:
Required Change:
Priority:
Status:
```

Implement feedback and show the revised prototype again.

# PHASE 18 --- UI Freeze

When the client approves:

``` text
CLIENT APPROVAL
      ↓
UI FREEZE
      ↓
DATABASE DESIGN
      ↓
BACKEND
```

Freeze:

-   Page structure
-   Fields
-   Forms
-   Navigation
-   Workflows
-   Business rules
-   Calculations
-   Main UI components

Do not randomly redesign the application after backend development
begins.

# PHASE 19 --- Database Design

Create `docs/DATABASE_DESIGN.md`.

Recommended models:

``` text
User
Labour
LabourRateHistory
Attendance
Payment
SalaryPeriod
Truck
TruckStatusHistory
AuditLog
```

Relationships:

``` text
Labour
 ├── Attendance
 ├── Payments
 └── Rate History

Truck
 └── Status History
```

# PHASE 20 --- Backend Setup

Only now create the backend.

``` bash
mkdir server
cd server
npm init -y

npm install express mongoose dotenv cors
npm install jsonwebtoken bcrypt express-validator
npm install -D nodemon
```

# PHASE 21 --- Backend Development Order

``` text
1. Express setup
2. Environment configuration
3. MongoDB connection
4. Authentication
5. Labour API
6. Attendance API
7. Payment API
8. Salary API
9. Truck API
10. Reports
11. Audit logging
12. Backup system
```

Request flow:

``` text
Route
 ↓
Middleware
 ↓
Controller
 ↓
Service
 ↓
Model
 ↓
MongoDB
```

# PHASE 22 --- Frontend → Backend Integration

Prototype:

``` text
React
 ↓
mock/labours.js
 ↓
UI
```

Final:

``` text
React
 ↓
Service
 ↓
Axios
 ↓
Express API
 ↓
Controller
 ↓
Service
 ↓
MongoDB
```

Create:

``` text
client/src/services/
├── api.js
├── labourService.js
├── attendanceService.js
├── paymentService.js
├── salaryService.js
└── truckService.js
```

Keep API calls outside page components.

# PHASE 23 --- Final Salary Logic

Production calculations belong on the backend.

``` text
Working Units
= Present Days + (Half Days × 0.5)

Earned Salary
= Working Units × Applicable Daily Rate

Total Received
= Booking Advances + Salary Payments

Balance
= Earned Salary - Total Received
```

If rates change:

``` text
01 Oct → ₹700
15 Oct → ₹750
```

Attendance before 15 Oct uses ₹700.

Attendance from 15 Oct onward uses ₹750.

Therefore maintain:

``` text
LabourRateHistory
```

Do not simply overwrite the old rate.

# PHASE 24 --- Financial Data Rules

Financial records should remain traceable.

Prefer:

``` text
Original Transaction
       ↓
Correction / Reversal Transaction
```

rather than silently deleting historical financial records.

Important for:

-   Booking advances
-   Salary payments
-   Salary calculations

# PHASE 25 --- Backup

Recommended:

``` text
MongoDB Atlas
      ↓
Scheduled mongodump
      ↓
Compressed Backup
      ↓
External Backup Storage
```

Keep multiple backup generations and periodically test restoration.

Do not keep the only backup on the same machine/server as the
application.

# Exact Starting Order

``` text
STEP 1
Create project root

STEP 2
Create React/Vite client

STEP 3
Create frontend folders

STEP 4
Install React Router + Axios

STEP 5
Build design system

STEP 6
Build reusable UI components

STEP 7
Build MainLayout

STEP 8
Build Sidebar + Header + Mobile Navigation

STEP 9
Configure routing

STEP 10
Build Dashboard with mock data

STEP 11
Build Labour Management

STEP 12
Build Labour Profile

STEP 13
Build Attendance

STEP 14
Build Payments

STEP 15
Build Weekly Salary

STEP 16
Build Trucks

STEP 17
Build Reports

STEP 18
Build Settings

STEP 19
Make everything responsive

STEP 20
Make prototype interactive

STEP 21
Test complete demo flow

STEP 22
Show client

STEP 23
Collect feedback

STEP 24
Implement feedback

STEP 25
Get final approval

STEP 26
FREEZE UI

=============================
ONLY NOW START BACKEND
=============================

STEP 27
Design MongoDB schemas

STEP 28
Build Express backend

STEP 29
Build APIs

STEP 30
Connect MongoDB

STEP 31
Connect React to APIs

STEP 32
Implement final business logic

STEP 33
Implement authentication/authorization

STEP 34
Implement reports

STEP 35
Implement backup

STEP 36
Test

STEP 37
Deploy
```

# Golden Rules

1.  Frontend first.
2.  Build one phase at a time.
3.  Use mock data during frontend development.
4.  Keep mock data separate from components.
5.  Build reusable components.
6.  Make every page responsive.
7.  Document business rules.
8.  Keep financial records traceable.
9.  Backend owns final financial/business calculations.
10. Freeze the approved UI before database/API development.
11. Never rely on a single database copy.
12. Test backups by restoring them.
13. Get explicit client approval before starting backend development.

# Immediate Starting Point

Do **not** start with Dashboard.

Start with:

``` text
PHASE 0
Requirements + Business Rules
        ↓
PHASE 1
React/Vite Setup
        ↓
PHASE 2
Design System
        ↓
PHASE 3
Main Layout + Routing
        ↓
PHASE 4
Dashboard
```

Your first target:

``` text
brick-business-management-system/
└── client/
    └── React + Vite
```

Then build the design system and application layout before business
modules.

# Frontend Definition of Done

-   [ ] All major pages exist
-   [ ] Navigation works
-   [ ] Mock data is realistic
-   [ ] Labour search works
-   [ ] Labour profile works
-   [ ] Attendance interaction works
-   [ ] Payment interaction works
-   [ ] Weekly salary preview works
-   [ ] Truck status interaction works
-   [ ] Reports page works
-   [ ] Forms have validation
-   [ ] Confirmation dialogs exist
-   [ ] Loading states exist
-   [ ] Empty states exist
-   [ ] Error states exist
-   [ ] Mobile works
-   [ ] Tablet works
-   [ ] Desktop works
-   [ ] No console errors
-   [ ] No broken navigation
-   [ ] No obvious placeholder content
-   [ ] Complete demo flow works

# Final Workflow

``` text
             FRONTEND
                ↓
          CLIENT REVIEW
                ↓
             FEEDBACK
                ↓
        CHANGES IMPLEMENTED
                ↓
         CLIENT APPROVAL
                ↓
            UI FREEZE
                ↓
       BACKEND DEVELOPMENT
                ↓
       API + DATABASE
                ↓
            TESTING
                ↓
        BACKUP + DEPLOY
```

> **Build the UI → Demo it → Get approval → Freeze it → Then build the
> backend.**
