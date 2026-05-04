export const hasUnclosedFence = (text: string) => {
  const fences = text.match(/```/g);
  return fences ? fences.length % 2 !== 0 : false;
};
