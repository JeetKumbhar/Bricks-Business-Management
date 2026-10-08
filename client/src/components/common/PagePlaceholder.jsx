import { Card, EmptyState } from "../ui";

/** Temporary stand-in used by AppRoutes until each page is built in its own phase. */
export default function PagePlaceholder({ title }) {
  return (
    <div className="space-y-5">
      <h1 className="type-page-heading">{title}</h1>
      <Card>
        <EmptyState title={`${title} page`} description="This page will be built in an upcoming phase." />
      </Card>
    </div>
  );
}
