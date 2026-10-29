"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TopicNavItem } from "@/lib/docs/topicNav";

// TOPIC BAR over Docs, like MDN's top bar: a button per topic with docs opens a menu with Overview (the list
// filtered to that topic) and New docs (the dialog with that topic picked), then its doc sets by sub-topic;
// "All" shows every set
export function DocsTopicNav({ items, activeKey }: { items: TopicNavItem[]; activeKey: string | null }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Topics" className="flex flex-wrap items-center gap-1">
      {items.map((item) => (
        <DropdownMenu key={item.key}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant={item.key === activeKey ? "secondary" : "ghost"} aria-current={item.key === activeKey ? "true" : undefined}>
              {item.label}
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem asChild><Link href={`/docs?topic=${encodeURIComponent(item.key)}`} className="font-medium">Overview</Link></DropdownMenuItem>
            {item.key.startsWith("topic:") ? <DropdownMenuItem asChild><Link href={`/docs?new=${item.topicId ?? ""}`}>New docs</Link></DropdownMenuItem> : null}
            {item.sections.map((section) => (
              <Fragment key={section.label ?? ""}>
                <DropdownMenuSeparator />
                {section.label ? <p className="max-w-80 px-1.5 pt-1 pb-0.5 text-xs text-muted-foreground">{section.label}</p> : null}
                {section.sets.map((set) => (
                  <DropdownMenuItem key={set.id} asChild><Link href={`/docs/${set.id}`} className="max-w-80">{set.title}</Link></DropdownMenuItem>
                ))}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
      <Button size="sm" variant={activeKey === null ? "secondary" : "ghost"} asChild><Link href="/docs">All</Link></Button>
    </nav>
  );
}
