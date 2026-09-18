import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Header from "../../../components/Header";
import StageClient from "../../../components/stage/StageClient";
import type { Category } from "../../../lib/types";

const STAGE_TITLES: Record<Category, string> = {
  people: "People stage",
  products: "Products stage",
  places: "Places stage",
};

const CATEGORIES = Object.keys(STAGE_TITLES) as Category[];

function asCategory(value: string): Category | null {
  return (CATEGORIES as string[]).includes(value) ? (value as Category) : null;
}

export function generateStaticParams() {
  return CATEGORIES.map((category) => ({ category }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const category = asCategory((await params).category);
  return {
    title: category
      ? `${STAGE_TITLES[category]} — SpeedMatch.tv`
      : "Stage — SpeedMatch.tv",
  };
}

export default async function StagePage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const category = asCategory((await params).category);
  if (!category) notFound();
  return (
    <>
      <Header />
      <StageClient category={category} />
    </>
  );
}
