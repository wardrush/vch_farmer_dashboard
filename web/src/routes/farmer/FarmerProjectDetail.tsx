import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Header } from "../../components/Header";
import { StageTracker } from "../../components/StageTracker";
import { StatCard } from "../../components/StatCard";
import { MapInlay } from "../../components/MapInlay";
import { useLiveOp, creditsSubmitted } from "../../lib/useLiveOp";
import { getOpFieldsGeoJson } from "../../lib/api";
import { MICRO_STAGES, MICRO_STAGE_LABEL, MICRO_STAGE_SHORT, MICRO_STAGE_COPY } from "../../content/stageCopy";
import { formatAcres, formatDate, formatTonnes } from "../../lib/format";

const CARRIED_FROM_BASELINE_STAGES = new Set(["enrollment_began", "all_files_submitted", "maps_approved", "baseline_samples_requested", "baseline_sampling_completed"]);

export function FarmerProjectDetail() {
  const { opCode, projectYearId } = useParams<{ opCode: string; projectYearId: string }>();
  const { profile, loading, error } = useLiveOp(opCode);
  const [fieldsGeoJson, setFieldsGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    if (!opCode) return;
    getOpFieldsGeoJson(opCode).then(setFieldsGeoJson).catch(() => setFieldsGeoJson({ type: "FeatureCollection", features: [] }));
  }, [opCode]);

  if (loading) return <Shell><p className="text-sand-600">Loading…</p></Shell>;
  if (error || !profile) return <Shell><p className="text-rust">We couldn&rsquo;t find that project.</p></Shell>;

  const project = profile.projects.find((p) => p.project_year_id === projectYearId);
  if (!project) return <Shell><p className="text-rust">We couldn&rsquo;t find that project year.</p></Shell>;

  const showCredits = creditsSubmitted(project.micro_stage);
  const carriedFromBaseline = project.year_index >= 2 ? CARRIED_FROM_BASELINE_STAGES : undefined;

  return (
    <Shell>
      <div className="mb-4">
        <Link to={`/farmer/${opCode}`} className="text-sm font-semibold text-gold-800 hover:underline">
          ← {profile.op_label}
        </Link>
        <h1 className="mt-1 text-3xl">
          Year {project.year_index} · {project.season_span}
        </h1>
      </div>

      <section className="vch-card mb-6">
        <StageTracker
          stageIds={[...MICRO_STAGES]}
          labels={MICRO_STAGE_SHORT}
          fullLabels={MICRO_STAGE_LABEL}
          currentStage={project.micro_stage}
          size="micro"
          carriedFromBaseline={carriedFromBaseline}
          copy={MICRO_STAGE_COPY}
          showCaption={false}
        />
        <p className="text-sm text-sand-700">{MICRO_STAGE_COPY[project.micro_stage]}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[55%_1fr]">
        <MapInlay
          fieldsGeoJson={fieldsGeoJson ?? undefined}
          clusterBboxes={profile.cluster_bboxes}
          opBounds={profile.op_bounds}
        />
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Acres submitted" value={formatAcres(project.acres)} />
          <StatCard label="Fields" value={profile.n_fields} />
          <StatCard label="Submitted on" value={formatDate(profile.submitted_at)} />
          <StatCard label="Project year" value={project.season_span} />
          <StatCard label="True-up" value={profile.true_up_year} />
          {showCredits ? (
            <StatCard label="Estimated current credits" value={formatTonnes(project.credited_t)} />
          ) : (
            <div className="rounded-2xl border border-sand-300 bg-white/60 p-4 text-xs text-sand-600">
              Estimates available after your project is submitted.
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Header section="Grower Dashboard" />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
