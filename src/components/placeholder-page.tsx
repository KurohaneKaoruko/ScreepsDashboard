interface PlaceholderPageProps {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <section className="panel placeholder-page">
      <span className="placeholder-tag">Planned</span>
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">{description}</p>
      <div className="hint-block">
        <p>This page is intentionally left as a placeholder for the initial UI.</p>
      </div>
    </section>
  );
}
