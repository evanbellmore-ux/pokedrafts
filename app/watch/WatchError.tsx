"use client";

import { useRouter } from "next/navigation";
import { Alert, Button } from "@/app/components/ui";

/** A failed server read on a Watch page, with Try again (a fresh server render). */
export default function WatchError({ title, message }: { title: string; message: string }) {
  const router = useRouter();
  return (
    <Alert
      variant="error"
      title={title}
      action={
        <Button size="sm" variant="secondary" onClick={() => router.refresh()}>
          Try again
        </Button>
      }
    >
      {message}
    </Alert>
  );
}
