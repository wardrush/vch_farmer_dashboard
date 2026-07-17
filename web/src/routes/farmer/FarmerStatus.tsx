import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Header } from "../../components/Header";
import { StageTracker } from "../../components/StageTracker";
import { StatCard } from "../../components/StatCard";
import { Callout } from "../../components/Callout";
import { DemoBadge } from "../../components/DemoBadge";
import { useLiveOp, creditsSubmitted } from "../../lib/useLiveOp";
import { MACRO_STAGES, MACRO_STAGE_LABEL, MACRO_STAGE_SHORT, MICRO_STAGES, MICRO_STAGE_LABEL, MICRO_STAGE_SHORT, MICRO_STAGE_COPY, CREDITS_CAP_CAVEAT } from "../../content/stageCopy";
import { formatAcres, formatDate, formatTonnes, formatUsd } from "../../lib/format";

export function FarmerStatus() {
  const { opCode } = useParams<{ opCode: string }>();
  const { profile, loading, error } = useLiveOp(opCode);
  const [expandedProjectYearId, setExpandedProjectYearId] = useState<string | null>(null);

  if (loading) return <PageShell><p className="text-sand-600">Loading…</p></PageShell>;
  if (error || !profile) return <PageShell><p className="text-rust">We couldn&rsquo;t find that grower.</p></PageShell>;

  const expandedProject = profile.projects.find((p) => p.project_year_id === expandedProjectYearId) ?? profile.projects[profile.projects.length - 1];
  const showCredits = creditsSubmitted(profile.current_micro_stage);

  return (
    <div>
      <Header section="Grower Dashboard" />
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-3xl">{profile.op_label}</h1>
          <p className="text-sand-700">
            {profile.entity_name !== profile.op_label && <>{profile.entity_name} · </>}
            Grower since {profile.grower_since.slice(0, 4)}
          </p>
        </div>

        <section className="vch-card">
          <h2 className="text-lg">Project status</h2>
          <StageTracker
            stageIds={[...MACRO_STAGES]}
            labels={MACRO_STAGE_SHORT}
            fullLabels={MACRO_STAGE_LABEL}
            currentStage={profile.macro_stage}
            size="macro"
            selectedStage={null}
          />
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-500">
              {expandedProject.season_span} detail
            </p>
            <StageTracker
              stageIds={[...MICRO_STAGES]}
              labels={MICRO_STAGE_SHORT}
              fullLabels={MICRO_STAGE_LABEL}
              currentStage={expandedProject.micro_stage}
              size="micro"
              copy={MICRO_STAGE_COPY}
              showCaption={false}
            />
            <p className="mt-3 text-sm text-sand-700">{MICRO_STAGE_COPY[expandedProject.micro_stage]}</p>
          </div>
        </section>

        <section className="vch-card">
          <h2 className="text-lg">Estimated credits</h2>
          {showCredits ? (
            <>
              <StatCard label="Estimated credits, current cycle" value={formatTonnes(profile.credited_t)} />
              <Callout>{CREDITS_CAP_CAVEAT} True-up settlement: {profile.true_up_year}.</Callout>
              {profile.credits_distributed_to_date != null && (
                <div className="flex items-center gap-2 text-sm text-sand-700">
                  <span>
                    Credits distributed to date: <strong>{formatUsd(profile.credits_distributed_to_date)}</strong>{" "}
                    ({formatTonnes(profile.credits_distributed_t_to_date)})
                  </span>
                  <DemoBadge />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-sand-600">Estimates will appear here after your project is submitted.</p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg">Projects</h2>
          {profile.projects.map((p) => (
            <div
              key={p.project_year_id}
              onClick={() => setExpandedProjectYearId(p.project_year_id)}
              className="flex cursor-pointer items-center justify-between rounded-2xl border border-sand-300 bg-white/90 p-4 transition hover:border-gold-700"
            >
              <div>
                <div className="font-semibold text-sand-950">Year {p.year_index} · {p.season_span}</div>
                <div className="text-xs text-sand-600">{formatAcres(p.acres)}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-gold-700 px-3 py-1 text-xs font-semibold text-gold-800">
                  {MICRO_STAGE_LABEL[p.micro_stage]}
                </span>
                <Link to={`/farmer/${opCode}/project/${p.project_year_id}`} className="text-sm font-semibold text-gold-800 hover:underline">
                  View →
                </Link>
              </div>
            </div>
          ))}
        </section>

        <div>
          <Link to={`/farmer/${opCode}/enrollments`} className="text-sm font-semibold text-gold-800 hover:underline">
            View enrollments →
          </Link>
        </div>
        {profile.submitted_at && (
          <p className="text-xs text-sand-500">Application submitted {formatDate(profile.submitted_at)}.</p>
        )}
      </main>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Header section="Grower Dashboard" />
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
