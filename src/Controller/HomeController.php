<?php

namespace App\Controller;

use App\Service\VelibApiService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class HomeController extends AbstractController
{
    #[Route('/', name: 'app_home')]
    public function index(VelibApiService $velibApiService): Response
    {
        return $this->render('map_libre/index.html.twig', [
            'stations' => $velibApiService->getStations(),
        ]);
    }
}
