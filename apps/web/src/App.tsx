import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardShell } from '@wep/ui';
import { ServicesProvider } from './lib/ServicesContext';
import { AwsIdentityBadge } from './components/AwsIdentityBadge';
import { OnboardingGate } from './components/Onboarding';
import { CredentialsExpiredBanner } from './components/CredentialsExpiredBanner';
import { AssistantWidget } from './components/AssistantWidget';
import { HubPage } from './pages/hub/PlatformHubPage';
import { DocsPage } from './pages/docs/DocsPage';
import { DocsSectionPage } from './pages/docs/DocsSectionPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { ServiceDetailPage } from './pages/catalog/ServiceDetailPage';
import { TeamDashboardPage } from './pages/catalog/TeamDashboardPage';
import { StaleServicesPage } from './pages/catalog/StaleServicesPage';
import { TechRadarPage } from './pages/catalog/TechRadarPage';
import { HealthSignalsPage } from './pages/measure/HealthSignalsPage';
import { DeploymentFeedPage } from './pages/deployments/DeploymentFeedPage';
import { PromotionTrackerPage } from './pages/deployments/PromotionTrackerPage';
import { EnvironmentComparePage } from './pages/deployments/EnvironmentComparePage';
import { ServiceDeploymentHistoryPage } from './pages/deployments/ServiceDeploymentHistoryPage';
import { VelocityDashboardPage } from './pages/velocity/VelocityDashboardPage';
import { ProjectHealthPage } from './pages/measure/ProjectHealthPage';
import { SprintDigestPage } from './pages/measure/SprintDigestPage';
import { QualityTrendPage } from './pages/measure/QualityTrendPage';
import { TeamVelocityPage } from './pages/velocity/TeamVelocityPage';
import { PipelineHealthPage } from './pages/pipelines/PipelineHealthPage';
import { CostOverviewPage } from './pages/costs/CostOverviewPage';
import { PortalHomePage } from './pages/portal/PortalHomePage';
import { PortalRequestPage } from './pages/portal/PortalRequestPage';
import { PortalRequestsPage } from './pages/portal/PortalRequestsPage';
import { PortalRequestDetailPage } from './pages/portal/PortalRequestDetailPage';
import { PortalApprovePage } from './pages/portal/PortalApprovePage';
import { PortalOperationsManagePage } from './pages/portal/PortalOperationsManagePage';
import { PortalOperationFormPage } from './pages/portal/PortalOperationFormPage';
import { RunbookDashboardPage } from './pages/portal/RunbookDashboardPage';
import { RunbookStudioPage } from './pages/portal/RunbookStudioPage';
import { JitResourcesPage } from './pages/portal/JitResourcesPage';
import { JitSessionsPage } from './pages/portal/JitSessionsPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { TeamsSettingsPage } from './pages/settings/TeamsSettingsPage';
import { SecurityFeedPage } from './pages/security/SecurityFeedPage';
import { SecurityReposPage } from './pages/security/SecurityReposPage';
import { GitLeaksPage } from './pages/security/GitLeaksPage';
import { NpmAuditPage } from './pages/security/NpmAuditPage';
import { VulnTrackerPage } from './pages/security/VulnTrackerPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ErrorsPage } from './pages/errors/ErrorsPage';
import { AnnouncementsPage } from './pages/announcements/AnnouncementsPage';
import { InfraResourcesPage } from './pages/infra/InfraResourcesPage';
import { DistributionsPage } from './pages/global/DistributionsPage';
import { DnsPage } from './pages/global/DnsPage';
import { CertificatesPage } from './pages/global/CertificatesPage';
import { RunbookAssistantPage } from './pages/ai/RunbookAssistantPage';
import { DeploymentDigestPage } from './pages/ai/DeploymentDigestPage';
import { CveTriagePage } from './pages/ai/CveTriagePage';
import { IncidentScribePage } from './pages/ai/IncidentScribePage';
import { CampaignImpactPage } from './pages/ai/CampaignImpactPage';
import { InfraSimulatorPage } from './pages/ai/InfraSimulatorPage';
import { CampaignApprovalPage } from './pages/ai/CampaignApprovalPage';
import { PrReviewPage } from './pages/ai/PrReviewPage';
import { ReleaseNotesPage } from './pages/ai/ReleaseNotesPage';
import { OncallBriefingPage } from './pages/ai/OncallBriefingPage';
import { DepAdvisorPage } from './pages/ai/DepAdvisorPage';
import { MyTeamPage } from './pages/teams/MyTeamPage';
import { AuthProvider } from './lib/auth';
import { DialogProvider } from './components/Dialog';
import { DependencyMapPage } from './pages/portfolio/DependencyMapPage';
import { CouplingDetectorPage } from './pages/portfolio/CouplingDetectorPage';
import { ServiceGraphPage } from './pages/portfolio/ServiceGraphPage';
import { RecommendationsPage } from './pages/portfolio/RecommendationsPage';
import { CostComparisonPage } from './pages/portfolio/CostComparisonPage';
import { ExecutiveSummaryPage } from './pages/portfolio/ExecutiveSummaryPage';
import { BudgetsPage } from './pages/portfolio/BudgetsPage';
import { CostInsightsPage } from './pages/portfolio/CostInsightsPage';
import { CostAttributionPage } from './pages/costs/CostAttributionPage';
import { IncidentsPage } from './pages/oncall/IncidentsPage';
import { SchedulePage } from './pages/oncall/SchedulePage';
import { AlertRulesPage } from './pages/notify/AlertRulesPage';
import { SubscriptionsPage } from './pages/notify/SubscriptionsPage';
import { WeeklyDigestPage } from './pages/notify/WeeklyDigestPage';
import { BroadcastsPage } from './pages/notify/BroadcastsPage';
import { DriftCachePage } from './pages/catalog/DriftCachePage';
import { BlogListPage } from './pages/blog/BlogListPage';
import { BlogPostPage } from './pages/blog/BlogPostPage';
import { BlogEditorPage } from './pages/blog/BlogEditorPage';
import { EnvConfigPage } from './pages/config/EnvConfigPage';
import { PostmortemListPage } from './pages/postmortem/PostmortemListPage';
import { PostmortemDetailPage } from './pages/postmortem/PostmortemDetailPage';
import { DepHealthPage } from './pages/deps/DepHealthPage';
import { TeamChangelogPage } from './pages/changelog/TeamChangelogPage';
import { OwnershipHeatmapPage } from './pages/catalog/OwnershipHeatmapPage';
import { LicenseCompliancePage } from './pages/security/LicenseCompliancePage';

export function App() {
  return (
    <AuthProvider>
    <DialogProvider>
    <ServicesProvider>
      <OnboardingGate />
      <CredentialsExpiredBanner />
      <Routes>
        {/* Standalone Home Page (Workbench Selector) */}
        <Route path="/" element={<HubPage />} />

        {/* Standalone Documentation Pages */}
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:section" element={<DocsSectionPage />} />

        {/* Operational Workbench (Wrapped in Shell) */}
        <Route
          path="/*"
          element={
            <DashboardShell headerRight={<AwsIdentityBadge />}>
              <Routes>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/errors" element={<ErrorsPage />} />
                <Route path="/announcements" element={<AnnouncementsPage />} />
                <Route path="/catalog" element={<CatalogPage />} />
                <Route path="/catalog/stale" element={<Navigate to="/measure/health-signals" replace />} />
                <Route path="/catalog/radar" element={<TechRadarPage />} />
                <Route path="/catalog/services/:serviceId" element={<ServiceDetailPage />} />
                <Route path="/catalog/teams/:teamId" element={<TeamDashboardPage />} />
                <Route path="/deployments" element={<DeploymentFeedPage />} />
                <Route path="/deployments/promotion" element={<PromotionTrackerPage />} />
                <Route path="/deployments/compare" element={<EnvironmentComparePage />} />
                <Route path="/deployments/services/:serviceId" element={<ServiceDeploymentHistoryPage />} />
                <Route path="/velocity" element={<VelocityDashboardPage />} />
                <Route path="/measure/health-signals" element={<HealthSignalsPage />} />
                <Route path="/measure/health" element={<Navigate to="/measure/health-signals" replace />} />
                <Route path="/measure/sprint" element={<SprintDigestPage />} />
                <Route path="/measure/quality" element={<Navigate to="/measure/health-signals" replace />} />
                <Route path="/velocity/teams/:teamId" element={<TeamVelocityPage />} />
                <Route path="/pipelines" element={<PipelineHealthPage />} />
                <Route path="/costs" element={<CostOverviewPage />} />
                <Route path="/costs/insights" element={<CostInsightsPage />} />
                <Route path="/costs/executive" element={<Navigate to="/costs/insights" replace />} />
                <Route path="/costs/comparison" element={<CostComparisonPage />} />
                <Route path="/costs/recommendations" element={<Navigate to="/costs/insights" replace />} />
                <Route path="/costs/budgets" element={<BudgetsPage />} />
                <Route path="/costs/attribution" element={<CostAttributionPage />} />
                <Route path="/catalog/service-graph" element={<ServiceGraphPage />} />
                <Route path="/catalog/drift" element={<DriftCachePage />} />
                <Route path="/catalog/dependencies" element={<Navigate to="/catalog/service-graph" replace />} />
                <Route path="/catalog/coupling" element={<Navigate to="/catalog/service-graph" replace />} />
                <Route path="/portal" element={<PortalHomePage />} />
                <Route path="/portal/request/:operationId" element={<PortalRequestPage />} />
                <Route path="/portal/operations/manage" element={<PortalOperationsManagePage />} />
                <Route path="/portal/operations/new" element={<PortalOperationFormPage />} />
                <Route path="/portal/operations/:operationId/edit" element={<PortalOperationFormPage />} />
                <Route path="/portal/runbooks" element={<RunbookDashboardPage />} />
                <Route path="/portal/runbooks/new" element={<RunbookStudioPage />} />
                <Route path="/portal/runbooks/:id/edit" element={<RunbookStudioPage />} />
                <Route path="/portal/runbooks/:id" element={<RunbookStudioPage />} />
                <Route path="/portal/approve/:requestId" element={<PortalApprovePage />} />
                <Route path="/portal/requests/:requestId" element={<PortalRequestDetailPage />} />
                <Route path="/portal/requests" element={<PortalRequestsPage />} />
                <Route path="/portal/jit-resources" element={<JitResourcesPage />} />
                <Route path="/portal/jit-sessions" element={<JitSessionsPage />} />
                <Route path="/my-team" element={<MyTeamPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/teams" element={<TeamsSettingsPage />} />
                <Route path="/security" element={<SecurityFeedPage />} />
                <Route path="/security/repos" element={<SecurityReposPage />} />
                <Route path="/security/gitleaks" element={<GitLeaksPage />} />
                <Route path="/security/npm-audit" element={<NpmAuditPage />} />
                <Route path="/security/vuln-tracker" element={<VulnTrackerPage />} />
                <Route path="/infra/resources" element={<InfraResourcesPage />} />
                <Route path="/global/distributions" element={<DistributionsPage />} />
                <Route path="/global/dns"           element={<DnsPage />} />
                <Route path="/global/certificates"  element={<CertificatesPage />} />
                <Route path="/ai/runbook"            element={<RunbookAssistantPage />} />
                <Route path="/ai/digest"             element={<DeploymentDigestPage />} />
                <Route path="/ai/cve-triage"         element={<CveTriagePage />} />
                <Route path="/ai/incident"           element={<IncidentScribePage />} />
                <Route path="/ai/campaign-impact"    element={<CampaignImpactPage />} />
                <Route path="/ai/infra-simulate"     element={<InfraSimulatorPage />} />
                <Route path="/ai/campaign-impact/approve/:approvalId" element={<CampaignApprovalPage />} />
                <Route path="/ai/pr-review"          element={<PrReviewPage />} />
                <Route path="/ai/release-notes"      element={<ReleaseNotesPage />} />
                <Route path="/ai/oncall-briefing"    element={<OncallBriefingPage />} />
                <Route path="/ai/dep-advisor"        element={<DepAdvisorPage />} />
                <Route path="/on-call/incidents" element={<IncidentsPage />} />
                <Route path="/on-call/schedule"  element={<SchedulePage />} />
                <Route path="/notify/alert-rules"    element={<AlertRulesPage />} />
                <Route path="/notify/subscriptions"  element={<SubscriptionsPage />} />
                <Route path="/notify/weekly-digest"  element={<WeeklyDigestPage />} />
                <Route path="/notify/broadcasts"     element={<BroadcastsPage />} />
                <Route path="/blog" element={<BlogListPage />} />
                <Route path="/blog/new" element={<BlogEditorPage />} />
                <Route path="/blog/edit/:id" element={<BlogEditorPage />} />
                <Route path="/blog/:slug" element={<BlogPostPage />} />
                <Route path="/config/env" element={<EnvConfigPage />} />
                <Route path="/postmortems" element={<PostmortemListPage />} />
                <Route path="/postmortems/new" element={<PostmortemDetailPage />} />
                <Route path="/postmortems/:id" element={<PostmortemDetailPage />} />
                <Route path="/postmortems/:id/edit" element={<PostmortemDetailPage />} />
                <Route path="/deps/health" element={<DepHealthPage />} />
                <Route path="/changelog" element={<TeamChangelogPage />} />
                <Route path="/catalog/ownership" element={<OwnershipHeatmapPage />} />
                <Route path="/security/licenses" element={<LicenseCompliancePage />} />
              </Routes>
            </DashboardShell>
          }
        />
      </Routes>
      <AssistantWidget />
    </ServicesProvider>
    </DialogProvider>
    </AuthProvider>
  );
}
