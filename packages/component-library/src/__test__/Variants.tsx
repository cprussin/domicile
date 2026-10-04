import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";

import { css } from "../../styled-system/css";
import { grid } from "../../styled-system/patterns";

type Props<Row, Column> =
  | {
      children: (row: Row, column: Column) => ReactNode;
      rows: Row[] | readonly Row[];
      rowLabel: (row: Row) => string;
      columns: Column[] | readonly Column[];
      columnLabel: (column: Column) => string;
    }
  | {
      children: (column: Column) => ReactNode;
      rows?: undefined;
      rowLabel?: undefined;
      columns: Column[] | readonly Column[];
      columnLabel: (column: Column) => string;
    }
  | {
      children: (row: Row) => ReactNode;
      rows: Row[] | readonly Row[];
      rowLabel: (row: Row) => string;
      columns?: undefined;
      columnLabel?: undefined;
    };

// A Storybook grid of component variants. Uses plain `<div>`s: a list can't
// hold header cells, and `role="grid"` would imply keyboard navigation.
export const Variants = <Row, Column>(props: Props<Row, Column>) => {
  const { rows, columns, columnLabel } = props;
  return (
    <div
      className={gridStyles}
      style={
        {
          "--columns": (columns?.length ?? 1) + (rows === undefined ? 0 : 1),
        } as CSSProperties
      }
    >
      {rows !== undefined && columns !== undefined && <span />}
      {columns?.map((column, i) => (
        <span className={columnHeaderStyles} key={i}>
          {columnLabel(column)}
        </span>
      ))}
      {renderCells(props)}
    </div>
  );
};

const renderCells = <Row, Column>(props: Props<Row, Column>): ReactNode => {
  if (props.rows === undefined) {
    return props.columns.map((column, columnNum) => (
      <div key={columnNum}>{props.children(column)}</div>
    ));
  } else if (props.columns === undefined) {
    return props.rows.map((row, rowNum) => (
      <Fragment key={rowNum}>
        <span className={rowHeaderStyles}>{props.rowLabel(row)}</span>
        <div>{props.children(row)}</div>
      </Fragment>
    ));
  } else {
    const { children, columns, rowLabel, rows } = props;
    return rows.map((row, rowNum) => (
      <Fragment key={rowNum}>
        <span className={rowHeaderStyles}>{rowLabel(row)}</span>
        {columns.map((column, columnNum) => (
          <div key={`${rowNum}-${columnNum}`}>{children(row, column)}</div>
        ))}
      </Fragment>
    ));
  }
};

const gridStyles = grid({
  gap: 8,
  gridTemplateColumns: "repeat(var(--columns), max-content)",
  placeItems: "center center",
});

const columnHeaderStyles = css({ fontWeight: "semibold" });

const rowHeaderStyles = css({ fontWeight: "semibold", marginInlineEnd: 4 });
