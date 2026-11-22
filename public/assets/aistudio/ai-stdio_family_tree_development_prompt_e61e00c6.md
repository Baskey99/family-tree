# Google AI Studio Development Prompt — Family Tree Management

## Objective

Implement a complete **Family Tree Creation & Management** feature in the existing application.

Users must be able to create, manage, and visualize family members and their relationships through an interactive canvas.

This must be a fully functional feature, not just a static UI mockup. Inspect the existing project first and integrate the feature using its current framework, architecture, UI components, state management, authentication, database, and storage conventions.

**Important:** Do not break existing features, modify unrelated modules, or unnecessarily refactor the existing application.

---

## 1. Family Tree Page

Create a **Family Tree** page accessible through the existing application navigation.

The page should include:

- Page title: Family Tree
- Subtitle: Build and explore your family relationships.
- Search family members by name
- Add Family Member button
- Interactive family tree canvas
- Canvas toolbar
- Member details panel or modal
- Expand and collapse family branches

Use the existing application design system, components, colors, typography, spacing, and layouts.

The design should be modern, clean, intuitive, responsive, and consistent with the existing application.

---

## 2. Family Member Profile

Each family member should support the following information:

| Field | Requirement |
|---|---|
| ID | Unique identifier |
| Profile Image | Optional photo upload |
| Full Name | Required |
| Gender | Male / Female |
| Date of Birth | Optional |
| Age | Automatically calculated from DOB |
| Manual Age | Allowed if DOB is unavailable |
| Address | Optional |
| Notes | Optional |
| Created At | Record creation timestamp |
| Updated At | Record modification timestamp |

### Profile Card

Display each member on the family tree canvas using a profile card containing:

- Profile image or avatar fallback
- Full name
- Age, if available
- Gender indicator

### Gender Identification

Use visually distinct indicators for:

- Male — Blue accent
- Female — Pink accent

Do not rely only on color. Display a readable gender label or icon as well.

### Age Calculation

- If DOB is provided, calculate age automatically.
- If DOB is not provided, allow the user to enter age manually.
- DOB should be optional.
- Calculate age correctly based on the current date and whether the birthday has occurred.
- When DOB is available, it should be the source of truth for age.

---

## 3. Interactive Family Tree Canvas

Create an interactive canvas that automatically organizes family members according to generations and relationships.

### Vertical Layout — Generations

The vertical direction represents the family generation hierarchy.

Arrange members from top to bottom:

1. Grandparents
2. Parents
3. Children
4. Grandchildren
5. Further generations as needed

### Rules

- Older generations must appear above younger generations.
- Parent-child relationships must be represented vertically.
- Each generation should have a clear visual separation.
- The tree should automatically arrange new family members.

Example:

```text
           Grandparents
                |
              Parents
                |
              Children
                |
           Grandchildren
```

### Horizontal Layout — Same Generation

The horizontal direction represents members belonging to the same generation.

Arrange the following horizontally:

- Brothers
- Sisters
- Cousins
- Spouses
- Other same-generation relatives

### Rules

- Spouses should appear adjacent to each other.
- Brothers and sisters should be grouped together.
- Children of the same parents should appear horizontally.
- Cousins should appear within their respective family branches but aligned at the same generation level.
- Maintain appropriate spacing between family branches.
- The layout must update automatically when members or relationships change.

---

## 4. Relationship Connections

Display clear relationship connectors between family members.

| Relationship | Canvas Representation |
|---|---|
| Parent → Child | Vertical hierarchical connection |
| Husband ↔ Wife | Horizontal connection |
| Brother ↔ Sister | Same-generation grouping |
| Cousins | Separate branches, same generation |
| Multiple Children | Shared parent branch |

Relationship lines should be clear, properly aligned, and should avoid overlapping profile cards.

Relationships must be stored in the data model. Do not determine relationships solely by visual position.

---

## 5. Add Family Member

When the user clicks **Add Family Member**, open a modal or side panel.

### Form Fields

- Profile photo upload
- Full Name
- Gender
  - Male
  - Female
- Date of Birth (Optional)
- Age
- Address
- Relationship Type
- Select Related Family Member

### Relationship Types

Support the following relationships:

- Father
- Mother
- Husband
- Wife
- Son
- Daughter
- Brother
- Sister
- Cousin
- Grandfather
- Grandmother
- Other

If Other is selected, allow the user to specify the relationship manually.

### Relationship Logic

The user should select an existing family member and define how the new person is related to them.

The system must:

- Determine the correct generation.
- Place the new member in the correct branch.
- Establish the relationship connection.
- Update the tree layout automatically.
- Avoid duplicating existing family members.
- Validate relationship consistency wherever possible.

---

## 6. Edit Family Member

Users should be able to edit an existing member's:

- Profile photo
- Name
- Gender
- DOB
- Age
- Address
- Notes

Editing personal details must not unintentionally break or remove existing relationships.

---

## 7. Delete Family Member

Provide the option to delete a family member.

Before deletion:

- Display a confirmation dialog.
- Explain if the person has existing family connections.
- Clarify what happens to connected relationships.
- Do not silently delete other family members.
- Avoid accidental deletion of entire branches.

---

## 8. Family Member Quick Actions

When a family member is selected or hovered over, provide actions:

- View Details
- Edit Member
- Add Relative
- Delete Member

Quick actions must also be accessible on mobile devices.

---

## 9. Canvas Controls

Implement the following functional controls:

- Zoom In
- Zoom Out
- Pan / Drag Canvas
- Fit Entire Tree
- Reset Layout
- Fullscreen
- Search Family Member
- Highlight Selected Member
- Expand Branch
- Collapse Branch
- Add Family Member
- Export Family Tree to PDF/Image, if supported

The canvas must support large family trees without being restricted to a small fixed container.

When no family members exist, display a proper empty state with an Add Family Member action.

---

## 10. Relationship Data Model

Keep relationship data separate from UI layout state.

The system should support:

- Parent-child relationships
- Spouse relationships
- Sibling relationships
- Cousin relationships

### Relationship Rules

- A person can have multiple children.
- A couple can have multiple children.
- Siblings can share one or two parents.
- Sibling relationships should preferably be derived from shared parent relationships.
- Cousin relationships should be derived from family branches wherever possible.
- Family branches can be expanded or collapsed.
- Do not duplicate a person when connecting relationships.
- Prevent circular parent-child relationships.
- Updating a relationship must safely update the tree.
- Layout positions should be derived from relationship data wherever possible.
- Manual positioning, if supported, must not modify relationship records.

---

## 11. Suggested Database Structure

First inspect the existing database and backend architecture. Adapt this structure to the existing project rather than introducing an entirely new backend.

### family_members

| Column | Description |
|---|---|
| id | Unique ID |
| tree_id | Family tree identifier |
| full_name | Full name |
| gender | Male/Female |
| date_of_birth | Nullable |
| manual_age | Nullable |
| address | Nullable |
| photo_url | Nullable |
| notes | Nullable |
| created_at | Timestamp |
| updated_at | Timestamp |

### family_relationships

| Column | Description |
|---|---|
| id | Unique ID |
| tree_id | Family tree identifier |
| person_id | First family member |
| related_person_id | Related family member |
| relationship_type | Parent-child / spouse |
| created_at | Timestamp |

Avoid storing redundant relationships.

For example, sibling relationships can be derived from shared parents instead of storing separate sibling records for every pair.

Use appropriate foreign keys, indexes, and database constraints.

Respect the existing authentication and authorization model. Users should only access and modify family-tree data they are authorized to manage.

---

## 12. User Experience Requirements

- Modern and polished UI.
- Consistent with the existing application's theme.
- Desktop: Canvas should use available screen space.
- Mobile: Canvas should support touch interactions.
- Profile cards should be readable.
- Relationship connectors should be easy to follow.
- Loading states should be implemented.
- Empty states should be implemented.
- Error states should be implemented.
- Success feedback should be implemented.
- Forms must include validation.
- Destructive actions must require confirmation.
- Keyboard navigation and focus states should be supported.
- Use accessible contrast and readable labels.
- Avoid unnecessary animations.

### Suggested Page Layout

#### Header

- Family Tree Title
- Search
- Add Family Member

#### Canvas Toolbar

- Zoom In
- Zoom Out
- Fit to View
- Reset Layout
- Fullscreen
- Export

#### Family Member Card

- Profile Image
- Full Name
- Age
- Gender
- Quick Actions

#### Member Details Panel

- Profile Photo
- Full Name
- Gender
- DOB
- Age
- Address
- Relationships
- Edit
- Add Relative

---

## 13. Performance Requirements

- Support large family trees.
- Avoid unnecessary rerenders during zoom, pan, and selection.
- Use efficient tree-layout calculations.
- Use memoization where appropriate.
- Persist changes reliably.
- Provide saving/saved/error feedback.
- Handle image upload failures.
- Handle database and network errors.
- Do not lose existing family data when relationships change.
- Keep relationship data separate from visual canvas coordinates.

---

## 14. Acceptance Criteria

- [ ] Family Tree page is accessible from the application.
- [ ] Users can create and manage family members.
- [ ] Profile image upload works.
- [ ] Avatar fallback is available.
- [ ] Name is required.
- [ ] Gender is required.
- [ ] DOB is optional.
- [ ] Age is calculated from DOB.
- [ ] Manual age can be entered if DOB is unavailable.
- [ ] Address can be saved.
- [ ] Male and female indicators are visually distinguishable and accessible.
- [ ] Generations are arranged vertically.
- [ ] Same-generation relatives are arranged horizontally.
- [ ] Spouses are positioned adjacent to each other.
- [ ] Parent-child connections are displayed.
- [ ] Siblings are grouped under shared parents.
- [ ] Cousins are positioned within their own branches at the correct generation.
- [ ] Members can be viewed, edited, and deleted.
- [ ] Relationships persist after reload.
- [ ] Search can locate and highlight a member.
- [ ] Zoom works.
- [ ] Pan works.
- [ ] Fit-to-view works.
- [ ] Fullscreen works.
- [ ] Branch expand/collapse works.
- [ ] Layout updates when relationships change.
- [ ] Loading, empty, error, and success states are handled.
- [ ] Responsive behavior works on desktop and mobile.
- [ ] Existing application functionality remains intact.

---

## 15. Implementation Instructions

Follow these instructions strictly:

1. Inspect the existing project before making any changes.
2. Identify the current framework, routes, components, state management, database, authentication, and storage.
3. Briefly identify the files/modules that need to be changed.
4. Reuse the existing components, design system, and architectural patterns.
5. Implement the feature end-to-end, including UI, relationships, layout, persistence, and validation.
6. Use a proper interactive tree/graph layout solution compatible with the existing project.
7. Do not implement the canvas as static cards or a non-functional mockup.
8. Do not modify unrelated features.
9. Do not replace the existing backend or database unnecessarily.
10. Do not leave placeholder buttons or TODO-only functionality.
11. Implement real data persistence using the project's existing backend.
12. Run the available build, lint, or tests after implementation.
13. Fix any errors introduced by the implementation.
14. Provide a final summary including:
    - Implemented features
    - Files created or modified
    - Database changes
    - Storage changes
    - Testing/build results
    - Any remaining setup requirements

**Do not stop after providing a plan or UI design. Proceed with the implementation in the existing project.**

---

## Final Expected Result

Deliver a fully functional **Family Tree Management System** with:

- Interactive canvas
- Family member profiles
- Photo uploads
- Relationship management
- Automatic hierarchical layout
- Generation-based organization
- Search
- Zoom and pan
- Expand/collapse branches
- Persistent data
- Responsive design

### Core Layout Principle

**Vertical = Generations**

Grandparents → Parents → Children → Grandchildren

**Horizontal = Same Generation**

Brothers · Sisters · Cousins · Spouses

The family tree should automatically maintain the hierarchy and relationships. Users should not need to manually draw relationship lines or position every family member to create a complete family tree.
