<?php

namespace App\Command;

use App\Service\VelibApiService;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(
    name: 'app:generate-velib-communes',
    description: 'Génère le GeoJSON des communes desservies par Vélib.'
)]
class GenerateVelibCommunesCommand extends Command
{
    public function __construct(
        private VelibApiService $velibApiService
    ) {
        parent::__construct();
    }

    protected function execute(
        InputInterface $input,
        OutputInterface $output
    ): int {

        $io = new SymfonyStyle($input, $output);

        $sourcePath = __DIR__
            . '/../../public/data/communes-100m.geojson';

        $targetPath = __DIR__
            . '/../../public/data/communes-velib.geojson';

        if (!file_exists($sourcePath)) {
            $io->error(
                'Le fichier communes-100m.geojson est introuvable.'
            );

            return Command::FAILURE;
        }

        $io->text('Lecture du fichier administratif...');

        $data = json_decode(
            file_get_contents($sourcePath),
            true,
            512,
            JSON_THROW_ON_ERROR
        );

        $stations = $this->velibApiService->getStations();

        $io->text(
            sprintf(
                '%d stations à analyser.',
                count($stations)
            )
        );

        $features = [];

$stationPoints = [];

foreach ($stations as $station) {

    if (
        !isset(
            $station['longitude'],
            $station['latitude']
        )
    ) {
        continue;
    }

    $stationPoints[] = [
        'longitude' => (float) $station['longitude'],
        'latitude' => (float) $station['latitude'],
    ];
}

foreach ($data['features'] as $commune) {

    $properties = $commune['properties'] ?? [];

    $code = (string) ($properties['code'] ?? '');

    // On ignore les arrondissements parisiens.
    if (str_starts_with($code, '751')) {
        continue;
    }

    $geometry = $commune['geometry'] ?? null;

    if (!$geometry) {
        continue;
    }

    $bounds = $this->getGeometryBounds($geometry);

    if (!$bounds) {
        continue;
    }

    $stationCount = 0;

    foreach ($stationPoints as $station) {

        // Test très rapide avant le calcul géométrique.
        if (
            $station['longitude'] < $bounds['minLng']
            || $station['longitude'] > $bounds['maxLng']
            || $station['latitude'] < $bounds['minLat']
            || $station['latitude'] > $bounds['maxLat']
        ) {
            continue;
        }

        if (
            $this->isPointInsideGeometry(
                $station['longitude'],
                $station['latitude'],
                $geometry
            )
        ) {
            $stationCount++;
        }
    }

    if ($stationCount === 0) {
        continue;
    }

    $commune['properties']['stationCount'] =
        $stationCount;

    $features[] = $commune;
}

        $result = [
            'type' => 'FeatureCollection',
            'features' => $features,
        ];

        file_put_contents(
            $targetPath,
            json_encode(
                $result,
                JSON_PRETTY_PRINT
                | JSON_UNESCAPED_UNICODE
                | JSON_UNESCAPED_SLASHES
            )
        );

        $io->success(
            sprintf(
                '%d communes générées dans communes-velib.geojson.',
                count($features)
            )
        );

        return Command::SUCCESS;
    }

    private function isPointInsideGeometry(
        float $longitude,
        float $latitude,
        array $geometry
    ): bool {

        if ($geometry['type'] === 'Polygon') {
            return $this->isPointInsidePolygon(
                $longitude,
                $latitude,
                $geometry['coordinates']
            );
        }

        if ($geometry['type'] === 'MultiPolygon') {

            foreach ($geometry['coordinates'] as $polygon) {

                if (
                    $this->isPointInsidePolygon(
                        $longitude,
                        $latitude,
                        $polygon
                    )
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    private function isPointInsidePolygon(
        float $longitude,
        float $latitude,
        array $polygon
    ): bool {

        if (empty($polygon)) {
            return false;
        }

        if (
            !$this->isPointInsideRing(
                $longitude,
                $latitude,
                $polygon[0]
            )
        ) {
            return false;
        }

        for ($i = 1; $i < count($polygon); $i++) {

            if (
                $this->isPointInsideRing(
                    $longitude,
                    $latitude,
                    $polygon[$i]
                )
            ) {
                return false;
            }
        }

        return true;
    }

    private function isPointInsideRing(
        float $longitude,
        float $latitude,
        array $ring
    ): bool {

        $inside = false;

        for (
            $i = 0,
            $j = count($ring) - 1;
            $i < count($ring);
            $j = $i++
        ) {
            $xi = $ring[$i][0];
            $yi = $ring[$i][1];

            $xj = $ring[$j][0];
            $yj = $ring[$j][1];

            $intersects =
                (($yi > $latitude) !== ($yj > $latitude))
                &&
                (
                    $longitude <
                    ($xj - $xi)
                    * ($latitude - $yi)
                    / ($yj - $yi)
                    + $xi
                );

            if ($intersects) {
                $inside = !$inside;
            }
        }

        return $inside;
    }


private function getGeometryBounds(
    array $geometry
): ?array {

    $coordinates = [];

    $collectCoordinates = function ($coords) use (
        &$collectCoordinates,
        &$coordinates
    ) {
        if (
            isset($coords[0])
            && is_numeric($coords[0])
        ) {
            $coordinates[] = $coords;
            return;
        }

        foreach ($coords as $coord) {
            $collectCoordinates($coord);
        }
    };

    $collectCoordinates(
        $geometry['coordinates']
    );

    if (empty($coordinates)) {
        return null;
    }

    $minLng = $coordinates[0][0];
    $maxLng = $coordinates[0][0];
    $minLat = $coordinates[0][1];
    $maxLat = $coordinates[0][1];

    foreach ($coordinates as $coordinate) {

        $minLng = min(
            $minLng,
            $coordinate[0]
        );

        $maxLng = max(
            $maxLng,
            $coordinate[0]
        );

        $minLat = min(
            $minLat,
            $coordinate[1]
        );

        $maxLat = max(
            $maxLat,
            $coordinate[1]
        );
    }

    return [
        'minLng' => $minLng,
        'maxLng' => $maxLng,
        'minLat' => $minLat,
        'maxLat' => $maxLat,
    ];
}

}