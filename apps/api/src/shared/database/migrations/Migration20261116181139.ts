import { Migration } from '@mikro-orm/migrations';

export class Migration20261116181139 extends Migration {
  override name = 'Migration20261116181139';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "enrollments" ("id" bigserial primary key, "created_at" timestamptz(3) not null, "updated_at" timestamptz(3) null, "created_by" bigint null, "updated_by" bigint null, "version" int not null default 1, "deleted_at" timestamptz(3) null, "phone_number" varchar(255) not null);`,
    );

    this.addSql(
      `alter table "enrollments" add constraint "base_entity_id_positive" check (id > 0);`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "enrollments" cascade;`);
  }
}
