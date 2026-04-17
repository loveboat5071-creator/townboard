import PageShell from '@/components/PageShell';
import ProposalWorkspace from '@/components/workspaces/ProposalWorkspace';

export const metadata = {
  title: '견적 / 기획 | 타운보드',
  description: '반경/지역 검색, 소재기획, PDF/PPT/Excel',
};

export default function ProposalPage() {
  return (
    <PageShell title="견적 / 기획" subtitle="반경/지역 검색, 소재기획, PDF/PPT/Excel" backHref="/">
      <ProposalWorkspace />
    </PageShell>
  );
}
