import Image from "next/image";
import Link from "next/link";

type Props = {
  href: string;
  subtitle?: string;
};

export default function Brand({ href, subtitle = "Portal" }: Props) {
  return (
    <Link href={href} className="brand">
      <Image
        src="/wareongo-logo.webp"
        alt="WareOnGo"
        width={120}
        height={85}
        priority
        className="brand-logo"
      />
      <span className="brand-sep" aria-hidden="true" />
      <span className="brand-text">
        <span className="brand-title">Reimbursement</span>
        <span className="brand-sub">{subtitle}</span>
      </span>
    </Link>
  );
}
