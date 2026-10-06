# Brick Business Management System — Development Guide

## 1. Project Goal

Build a production-ready MERN application for a brick manufacturing
business.

Core features:

- Labour management
- Daily attendance: Present / Half Day / Absent
- Labour-specific daily rates and rate history
- Booking/starting advances
- Mid-week salary payments
- Weekly salary calculation
- Total received and remaining balance
- Truck management
- Working / stopped / maintenance status
- Truck stop reasons and history
- Reports and exports
- Authentication and roles
- Audit logs
- Automated MongoDB backups
- Responsive laptop + mobile UI

------------------------------------------------------------------------

## 2. Technology Stack

### Frontend

- React + Vite
- React Router
- Axios
- Tailwind CSS
- Recharts
- React Hook Form
- Zod
- Context API or Zustand

### Backend

- Node.js
- Express.js
- MongoDB Atlas
- Mongoose
- JWT
- bcrypt/bcryptjs
- Validation library
- node-cron
- `mongodump`

### Production architecture

``` text
React
  ↓ HTTPS
Express API
  ↓
MongoDB Atlas Free
  ↓
Scheduled mongodump
  ↓
External backup storage
```

------------------------------------------------------------------------

# 3. Do NOT Start With the Dashboard

Do not develop in this order:

``` text
Dashboard.jsx → random pages → random APIs → database later
```

Use this order instead:

``` text
Requirements
    ↓
Business Rules
    ↓
Database Schema
    ↓
API Design
    ↓
Backend
    ↓
Frontend
    ↓
Integration
    ↓
Testing
    ↓
Deployment
    ↓
Backup
```

The database and business rules are the foundation.

------------------------------------------------------------------------

# 4. Phase 0 — Confirm Business Rules

Before coding, confirm these with the client.

### Labour

- Required fields?
- Is mobile mandatory?
- Is address required?
- Is photo required?
- Can labour leave and return?
- Can the daily rate change?
- How should rate changes work?

### Attendance

- Present = 1 day?
- Half Day = 0.5 day?
- Absent = 0?
- Can attendance be edited?
- Which day starts the working week?
- Are there holidays?

### Payments

- What exactly is a booking advance?
- Does advance count toward total received?
- What payment types exist?
- Can payments be corrected?
- Should incorrect payments be reversed instead of deleted?

### Salary

- What dates define a salary week?
- Is salary calculated automatically?
- Can salary be manually adjusted?
- What happens if a labour is overpaid?

### Trucks

- Required truck information?
- Working / stopped / maintenance?
- Is driver information needed?
- Which stop reasons should be recorded?
- Is maintenance history required?

Write these decisions in `docs/BUSINESS_RULES.md`.

------------------------------------------------------------------------

# 5. Phase 1 — Project Setup

Create:

``` text
brick-business-management-system/
├── client/
├── server/
└── docs/
```

Initialize Git immediately:

``` bash
git init
```

Create:

``` text
README.md
.gitignore
```

Never commit:

``` text
.env
node_modules/
backups/
uploads/
temp/
```

------------------------------------------------------------------------

# 6. Phase 2 — Backend First

Start in:

``` text
server/
```

Initialize:

``` bash
npm init -y
```

Install:

``` bash
npm install express mongoose dotenv cors cookie-parser bcryptjs jsonwebtoken
npm install -D nodemon
```

Recommended structure:

``` text
server/
├── config/
├── constants/
├── controllers/
├── cron/
├── jobs/
├── middlewares/
├── models/
├── routes/
├── services/
├── utils/
├── validators/
├── uploads/
├── temp/
├── app.js
└── server.js
```

------------------------------------------------------------------------

# 7. Phase 3 — Environment Configuration

Create:

``` text
server/.env
```

Example:

``` env
PORT=5000
NODE_ENV=development

MONGODB_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_long_random_secret

CLIENT_URL=http://localhost:5173

BACKUP_DIR=./backups
```

Never hard-code secrets in source code.

------------------------------------------------------------------------

# 8. Phase 4 — MongoDB Connection

Create:

``` text
server/config/db.js
```

Responsibilities:

- Connect to MongoDB Atlas
- Handle connection errors
- Log successful connection

First milestone:

``` text
Node server
    ↓
MongoDB Atlas
    ↓
Connection successful
```

Do this before building APIs.

------------------------------------------------------------------------

# 9. Phase 5 — Database Design

Recommended collections:

``` text
users
labours
labourRateHistory
attendance
payments
salaryPeriods
trucks
truckStatusHistory
auditLogs
```

Keep attendance and payments separate from the labour document.

------------------------------------------------------------------------

# 10. Labour Model

Create:

``` text
server/models/Labour.js
```

Fields:

``` text
labourId
name
phone
address
joiningDate
status
photo
createdAt
updatedAt
```

Example:

``` text
L-001
Ramesh Kumar
9876543210
ACTIVE
```

Do not store all attendance/payments inside this document.

------------------------------------------------------------------------

# 11. Labour Rate History

Create:

``` text
server/models/LabourRateHistory.js
```

Example:

``` text
L-001
₹600
Effective: 01/10/2026
```

Later:

``` text
L-001
₹650
Effective: 16/10/2026
```

This prevents old salary calculations from changing when the current
rate changes.

------------------------------------------------------------------------

# 12. Attendance Model

Create:

``` text
server/models/Attendance.js
```

Fields:

``` text
labourId
date
status
workingUnits
markedBy
createdAt
updatedAt
```

Statuses:

``` text
PRESENT
HALF_DAY
ABSENT
```

Working units:

``` text
PRESENT  = 1
HALF_DAY = 0.5
ABSENT   = 0
```

Create a unique index for:

``` text
labourId + date
```

This prevents duplicate attendance for the same labour/date.

------------------------------------------------------------------------

# 13. Payment Model

Create:

``` text
server/models/Payment.js
```

Fields:

``` text
labourId
amount
type
date
note
createdBy
status
createdAt
updatedAt
```

Payment types:

``` text
BOOKING_ADVANCE
SALARY_PAYMENT
OTHER
```

For incorrect financial entries, prefer:

``` text
REVERSED
```

over permanently deleting the record.

------------------------------------------------------------------------

# 14. Salary Calculation Rules

Define the rules before writing the salary API.

``` text
Working Units
= Present Days + (Half Days × 0.5)
```

``` text
Earned Salary
= Working Units × Applicable Daily Rate
```

``` text
Total Received
= Included Advances + Included Salary Payments
```

``` text
Balance
= Earned Salary - Total Received
```

Example:

``` text
Present = 20
Half Day = 3
Rate = ₹650

Working Units = 20 + (3 × 0.5)
              = 21.5

Earned Salary = 21.5 × 650
              = ₹13,975

Received = ₹9,000

Balance = ₹4,975
```

Do not make one stored `salary` field the source of truth. Calculate
salary from attendance, applicable rates, and payments.

------------------------------------------------------------------------

# 15. Salary Service

Create:

``` text
server/services/salary.service.js
```

Keep complex salary logic here.

Possible functions:

``` text
calculateSalaryForPeriod()
getLabourSalarySummary()
getWeeklySalary()
getLabourBalance()
```

Controllers should call services rather than containing all calculation
logic.

------------------------------------------------------------------------

# 16. Salary Period Model

Create:

``` text
server/models/SalaryPeriod.js
```

Example:

``` text
Week 1
01 Oct - 07 Oct
```

Fields:

``` text
startDate
endDate
status
processedAt
processedBy
```

Statuses:

``` text
OPEN
PROCESSING
PROCESSED
CLOSED
```

------------------------------------------------------------------------

# 17. Truck Models

Create:

``` text
server/models/Truck.js
server/models/TruckStatusHistory.js
```

Truck fields:

``` text
truckNumber
model
driver
status
notes
createdAt
updatedAt
```

Statuses:

``` text
WORKING
STOPPED
MAINTENANCE
```

Status history:

``` text
truckId
status
reason
startDate
endDate
createdBy
```

This allows future downtime reports.

------------------------------------------------------------------------

# 18. Authentication

Create:

``` text
server/models/User.js
server/controllers/auth.controller.js
server/routes/auth.routes.js
server/middlewares/auth.middleware.js
```

Implement:

``` text
Login
Logout
Current User
Password Hashing
JWT Authentication
Role Authorization
```

Start with:

``` text
OWNER
```

Later:

``` text
OWNER
MANAGER
ACCOUNTANT
```

------------------------------------------------------------------------

# 19. API Design

Recommended routes:

``` text
/api/auth
/api/labours
/api/attendance
/api/payments
/api/salary
/api/trucks
/api/reports
/api/users
/api/settings
/api/audit-logs
```

### Labour

``` text
GET    /api/labours
POST   /api/labours
GET    /api/labours/:id
PATCH  /api/labours/:id
PATCH  /api/labours/:id/status
```

### Attendance

``` text
GET    /api/attendance
POST   /api/attendance
PATCH  /api/attendance/:id
```

### Payments

``` text
GET    /api/payments
POST   /api/payments
GET    /api/payments/:id
PATCH  /api/payments/:id/reverse
```

### Salary

``` text
GET /api/salary/weekly
GET /api/salary/labour/:labourId
GET /api/salary/period/:periodId
```

### Trucks

``` text
GET  /api/trucks
POST /api/trucks
PATCH /api/trucks/:id
POST /api/trucks/:id/status
GET  /api/trucks/:id/history
```

------------------------------------------------------------------------

# 20. Backend Layering

Use:

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

Controller responsibility:

``` text
Receive request
↓
Validate/authorize
↓
Call service
↓
Return response
```

Keep business logic out of controllers.

------------------------------------------------------------------------

# 21. Validation and Error Handling

Validate on the backend even if React validates too.

Validate:

- Labour name
- Phone
- Rate
- Attendance status
- Payment amount
- Payment type
- Truck number
- Truck status

Use consistent responses.

Success:

``` json
{
  "success": true,
  "data": {}
}
```

Error:

``` json
{
  "success": false,
  "message": "Labour not found"
}
```

Create:

``` text
server/middlewares/error.middleware.js
```

------------------------------------------------------------------------

# 22. Test the Backend Before React

Use Postman or Thunder Client.

Test in this order:

``` text
1. Database connection
2. Authentication
3. Add labour
4. Get labour
5. Update labour
6. Add attendance
7. Update attendance
8. Add payment
9. Calculate salary
10. Add truck
11. Change truck status
12. Get truck history
```

Do not connect the entire frontend until the core APIs work.

------------------------------------------------------------------------

# 23. Phase 6 — Frontend Setup

Then move to:

``` text
client/
```

Recommended:

``` text
client/src/
├── assets/
├── components/
├── context/
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── labours/
│   ├── attendance/
│   ├── payments/
│   ├── salary/
│   ├── trucks/
│   ├── reports/
│   └── settings/
├── hooks/
├── layouts/
├── pages/
├── routes/
├── services/
├── utils/
├── validators/
├── App.jsx
└── main.jsx
```

------------------------------------------------------------------------

# 24. Build the Main Layout First

Create:

``` text
layouts/
├── MainLayout.jsx
├── Sidebar.jsx
├── Header.jsx
└── MobileBottomNav.jsx
```

Desktop:

``` text
Sidebar + Header + Page
```

Mobile:

``` text
Header
  ↓
Page
  ↓
Bottom Navigation
```

Use the same visual language across every page.

------------------------------------------------------------------------

# 25. Frontend Authentication

Create:

``` text
pages/Login.jsx
context/AuthContext.jsx
services/authService.js
```

Flow:

``` text
Login
 ↓
POST /api/auth/login
 ↓
Authenticated session
 ↓
Dashboard
```

Protect private routes.

------------------------------------------------------------------------

# 26. Build Dashboard

After authentication and core APIs.

Show:

``` text
Total Labour
Present Today
Half Days Today
Absent Today
Working Trucks
Stopped Trucks
Weekly Salary
Pending Salary
```

Charts:

``` text
Weekly Attendance
Truck Status
```

Tables:

``` text
Recent Payments
Recent Activities
Upcoming Salary Distribution
```

Quick actions:

``` text
Mark Attendance
Add Labour
Record Payment
Update Truck Status
Generate Report
```

------------------------------------------------------------------------

# 27. Build Labour Management

Create:

``` text
features/labours/
├── components/
│   ├── LabourTable.jsx
│   ├── LabourFilters.jsx
│   ├── LabourSummaryCards.jsx
│   ├── AddLabourModal.jsx
│   └── LabourDetails.jsx
└── labourService.js
```

Page:

``` text
pages/LabourManagement.jsx
```

Features:

- Search by name
- Search by Labour ID
- Search by mobile
- Filter active/inactive
- Add labour
- Edit labour
- View labour
- Deactivate labour
- View rate
- View balance

------------------------------------------------------------------------

# 28. Build Labour Profile

This is one of the most important pages.

Show:

``` text
Name
Labour ID
Current Rate
Status
Joining Date
```

Attendance summary:

``` text
Present
Half Days
Absent
Working Units
```

Financial summary:

``` text
Earned Salary
Booking Advance
Salary Payments
Total Received
Balance
```

History:

``` text
Attendance History
Payment History
Rate History
```

------------------------------------------------------------------------

# 29. Build Attendance

The owner should be able to mark attendance quickly.

Suggested flow:

``` text
Select Date
   ↓
Search Labour
   ↓
Present / Half Day / Absent
   ↓
Save
```

Useful features:

``` text
Mark All Present
Present filter
Absent filter
Half Day filter
Date selector
Search
```

A “Mark All Present” shortcut can save significant time when only a few
workers are absent/half-day.

------------------------------------------------------------------------

# 30. Build Payments

Flow:

``` text
Select Labour
   ↓
Payment Type
   ↓
Amount
   ↓
Date
   ↓
Note
   ↓
Confirm
```

Show:

``` text
Date
Labour
Type
Amount
Recorded By
Status
```

------------------------------------------------------------------------

# 31. Build Weekly Salary

Show:

``` text
Week: 01 Oct - 07 Oct

Labour      Earned     Paid     Balance
Ramesh      ₹4,225     ₹3,000   ₹1,225
Suresh      ₹4,550     ₹5,000   -₹450
```

Actions:

``` text
View Details
Process Week
Export
```

------------------------------------------------------------------------

# 32. Build Truck Management

Create:

``` text
features/trucks/
├── TruckTable.jsx
├── TruckForm.jsx
├── TruckStatusModal.jsx
├── TruckHistory.jsx
└── truckService.js
```

Show:

``` text
Total Trucks
Working
Stopped
Maintenance
```

Table:

``` text
Truck Number
Model
Driver
Status
Stopped Since
Reason
Actions
```

------------------------------------------------------------------------

# 33. Build Reports

Create:

``` text
pages/Reports.jsx
```

Reports:

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
Payment Type
Status
```

Exports:

``` text
CSV
Excel
PDF
```

Prefer backend aggregation for report calculations.

------------------------------------------------------------------------

# 34. Audit Logs

Record important actions:

``` text
Labour Created
Labour Updated
Attendance Changed
Payment Created
Payment Reversed
Truck Status Changed
Salary Processed
User Created
```

Store:

``` text
user
action
entity
entityId
oldValue
newValue
timestamp
```

This is important because the application manages money.

------------------------------------------------------------------------

# 35. Backup System

Implement before production.

Suggested structure:

``` text
server/
├── cron/
│   └── backup.cron.js
├── jobs/
│   └── databaseBackup.js
└── utils/
    └── backup.js
```

Flow:

``` text
Scheduled time
   ↓
mongodump
   ↓
Compress backup
   ↓
Upload/store externally
   ↓
Record success/failure
```

Example:

``` text
backups/
├── 2026-10-01.zip
├── 2026-10-02.zip
├── 2026-10-03.zip
└── ...
```

Do not keep the only backup on the same server as the application.

------------------------------------------------------------------------

# 36. Backup Retention

A practical starting policy:

``` text
Daily backups: keep 7–30
Weekly backups: keep several weeks
Monthly backups: keep several months
```

Also provide:

``` text
Backup Now
```

in the admin settings.

Most importantly: test restoring a backup before calling the system
production-ready.

------------------------------------------------------------------------

# 37. Data Export

Add:

``` text
Export Labour
Export Attendance
Export Payments
Export Salary
Export Trucks
```

This gives the owner another recovery and reporting option.

------------------------------------------------------------------------

# 38. Security Checklist

Before production:

``` text
[ ] HTTPS
[ ] Strong JWT secret
[ ] Password hashing
[ ] Backend validation
[ ] Rate limiting
[ ] CORS configured
[ ] Security headers
[ ] MongoDB credentials hidden
[ ] No secrets in Git
[ ] Authentication middleware
[ ] Role-based authorization
[ ] Audit logs
[ ] Backup system
```

------------------------------------------------------------------------

# 39. Testing

### Labour

``` text
[ ] Add
[ ] Edit
[ ] Search
[ ] Deactivate
[ ] View profile
[ ] Change rate
[ ] Rate history
```

### Attendance

``` text
[ ] Present
[ ] Half Day
[ ] Absent
[ ] Edit
[ ] Duplicate prevention
[ ] Correct working units
```

### Payments

``` text
[ ] Booking advance
[ ] Salary payment
[ ] Payment history
[ ] Reversal
[ ] Balance update
```

### Salary

``` text
[ ] Present calculation
[ ] Half-day calculation
[ ] Rate history
[ ] Advance included
[ ] Payments included
[ ] Balance correct
[ ] Weekly calculation
```

### Trucks

``` text
[ ] Add
[ ] Working
[ ] Stopped
[ ] Stop reason
[ ] History
```

------------------------------------------------------------------------

# 40. Test Real-World Scenarios

Do not only test happy paths.

### Scenario 1 — Half Days

``` text
20 Present
3 Half Days
2 Absent
Rate ₹650
```

Verify the salary.

### Scenario 2 — Rate Change

A labour changes from ₹600/day to ₹650/day halfway through the week.

Old dates must use ₹600 and new dates must use ₹650.

### Scenario 3 — Advance

A labour receives money before work starts.

Verify it appears in total received and affects the balance according to
the agreed business rule.

### Scenario 4 — Multiple Payments

A labour receives several payments during the week.

Verify the total and balance.

### Scenario 5 — Overpayment

Received \> earned.

Verify negative balance/overpayment handling.

### Scenario 6 — Attendance Correction

Attendance changes after salary was calculated.

Verify the system handles the adjustment safely.

### Scenario 7 — Payment Reversal

Reverse an incorrect payment.

Verify history remains and the balance changes correctly.

------------------------------------------------------------------------

# 41. Mobile Testing

Test at least:

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

Pay special attention to:

``` text
Dashboard
Labour
Attendance
Payments
Trucks
Labour Profile
```

Attendance must be particularly fast and comfortable on a phone.

------------------------------------------------------------------------

# 42. Build Modules as Vertical Slices

Do not build all frontend first and all backend later.

Instead:

``` text
LABOUR
Database
 ↓
Model
 ↓
API
 ↓
Service
 ↓
React service
 ↓
Page
 ↓
Testing
```

Then:

``` text
ATTENDANCE
```

Then:

``` text
PAYMENTS
```

Then:

``` text
SALARY
```

This dramatically reduces debugging complexity.

------------------------------------------------------------------------

# 43. Exact Development Order

Follow this sequence:

``` text
01  Project setup
02  MongoDB Atlas setup
03  Environment variables
04  Database connection
05  User authentication
06  Labour models + APIs
07  Labour frontend
08  Labour profile
09  Attendance models + APIs
10  Attendance frontend
11  Payment model + APIs
12  Payment frontend
13  Salary calculation service
14  Weekly salary frontend
15  Truck models + APIs
16  Truck frontend
17  Reports
18  Audit logs
19  Backup system
20  Security hardening
21  Full testing
22  Deployment
23  Production backup verification
24  Client handover
```

------------------------------------------------------------------------

# 44. Git Workflow

Use feature branches:

``` text
main
develop
feature/labour
feature/attendance
feature/payments
feature/salary
feature/trucks
```

Example:

``` bash
git checkout -b feature/labour
```

Commit:

``` bash
git add .
git commit -m "feat: add labour management"
git push
```

Keep `main` stable.

Recommended commit prefixes:

``` text
feat:
fix:
refactor:
docs:
test:
chore:
```

------------------------------------------------------------------------

# 45. Deployment

Production architecture:

``` text
React
 ↓
Frontend hosting
 ↓ HTTPS
Express API
 ↓
MongoDB Atlas
```

Set production environment variables separately.

Example:

``` env
NODE_ENV=production
MONGODB_URI=production_database
JWT_SECRET=strong_production_secret
CLIENT_URL=https://your-frontend-domain.com
```

Use separate development and production databases when possible.

------------------------------------------------------------------------

# 46. Before Client Handover

Checklist:

``` text
[ ] Owner account created
[ ] Password secured
[ ] Labour data imported
[ ] Truck data imported
[ ] Attendance tested
[ ] Payments tested
[ ] Salary tested
[ ] Reports tested
[ ] Backup tested
[ ] Restore tested
[ ] Mobile tested
[ ] Desktop tested
[ ] HTTPS working
[ ] Error handling working
[ ] Audit logs working
[ ] Database credentials secured
```

Do an actual restore test. A backup is not proven until it can be
restored.

------------------------------------------------------------------------

# 47. V1 Scope

Keep V1 focused:

``` text
Authentication
      +
Labour
      +
Attendance
      +
Payments
      +
Weekly Salary
      +
Trucks
      +
Reports
      +
Audit Logs
      +
Backups
```

Do not add inventory, sales, customers, fuel, accounting, etc. unless
the client actually needs them.

------------------------------------------------------------------------

# 48. Future V2 Features

Possible later features:

``` text
WhatsApp notifications
SMS notifications
Payment receipts
Truck fuel tracking
Truck maintenance expenses
Brick production tracking
Raw material inventory
Customer management
Supplier management
Sales/invoices
Expense management
Profit/loss
Multiple factories
Multiple branches
Multiple admins
Advanced analytics
```

Build the core system first.

------------------------------------------------------------------------

# 49. Final Architecture

``` text
                    BRICKPRO
                       │
                 React Frontend
                       │
                 Axios / HTTPS
                       │
                 Express Backend
                       │
        ┌──────────────┼───────────────┐
        │              │               │
     Labour        Attendance       Payments
        │              │               │
        └──────────────┼───────────────┘
                       │
                  Salary Engine
                       │
                       ▼
                    MongoDB
                       │
          ┌────────────┴────────────┐
          │                         │
        Trucks                  Audit Logs
          │
          ▼
   Truck Status History

MongoDB
   │
   ▼
Scheduled mongodump
   │
   ▼
External Backup Storage
```

------------------------------------------------------------------------

# 50. Your First Coding Task

When you start coding, do NOT start with:

``` text
Dashboard.jsx
```

Start with:

``` text
server/
```

Then:

``` text
1. npm init
2. Install dependencies
3. Create .env
4. Create config/db.js
5. Connect MongoDB Atlas
6. Create User model
7. Create Labour model
8. Create LabourRateHistory model
9. Create Attendance model
10. Create Payment model
11. Create SalaryPeriod model
12. Create Truck model
13. Create TruckStatusHistory model
```

Then implement authentication and Labour APIs.

After the database and APIs work, start React.

------------------------------------------------------------------------

# 51. Golden Rules

Always think:

``` text
REAL BUSINESS DATA
       ↓
MUST BE CORRECT
       ↓
MUST BE TRACEABLE
       ↓
MUST NOT BE ACCIDENTALLY LOST
```

Therefore:

- Do not hard-code salary calculations.
- Do not casually delete financial history.
- Do not store everything in one MongoDB document.
- Do not trust frontend validation alone.
- Do not put secrets in Git.
- Do not rely on one copy of the database.
- Do not deploy without testing restore from backup.
- Document business rules before changing them.

------------------------------------------------------------------------

# 52. Final Starting Point

Your immediate roadmap is:

``` text
TODAY
│
├── Open the project
├── Read the architecture
├── Confirm business rules with client
└── Design MongoDB schemas
        ↓
NEXT
├── Setup server
├── Connect MongoDB Atlas
├── Create User + Labour models
└── Build Labour APIs
        ↓
THEN
├── Build Labour Management UI
├── Build Labour Profile
└── Connect frontend ↔ backend
        ↓
THEN
├── Attendance
├── Payments
├── Salary
└── Trucks
        ↓
FINALLY
├── Reports
├── Audit Logs
├── Automated Backups
├── Testing
└── Production Deployment
```

**The first file you should actively work on is `server/config/db.js`,
but before writing it, finalize the database schemas and business rules.
Do not begin by coding the dashboard.**
