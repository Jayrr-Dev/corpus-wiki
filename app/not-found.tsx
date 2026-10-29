import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

// NOT FOUND: any address with no screen behind it
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <EmptyState
        icon={PageIcon}
        title="Nothing lives at this address"
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/pages">Go to Wiki</Link>
          </Button>
        }
      />
    </div>
  );
}
